import Anthropic from "@anthropic-ai/sdk";
import { routeIntent } from "./intentRouter.js";
import { runCommerceTool } from "../commerce/commerceTools.js";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOOL_TURNS = 6;

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// session = { commerceUsername, commerceToken } for an authenticated request, or undefined
// for the unauthenticated/mock dev path. Threaded through to every tool call so live Commerce
// requests run under the logged-in admin's own token, not a shared one.
export async function answerQuestion({ question, history, session }) {
  const context = { token: session?.commerceToken };

  if (process.env.ANTHROPIC_API_KEY) {
    return answerWithClaudeTools({ question, history, context });
  }

  const intent = routeIntent(question);
  const toolResult = await runCommerceTool(intent.toolName, intent.args, context);

  return buildResponse({
    toolCalls: [{ name: intent.toolName, args: intent.args, source: toolResult.source }],
    answer: formatDeterministicAnswer(intent.toolName, toolResult),
    data: toolResult.data,
  });
}

// Lets Claude call multiple commerce tools in sequence within one turn (e.g. look up a
// customer, then their orders, then a return) instead of being forced into exactly one
// tool per question. tool_choice stays "auto" so Claude can also just answer directly
// (greetings, clarifying questions) without forcing an irrelevant tool call.
async function answerWithClaudeTools({ question, history, context }) {
  const client = getAnthropicClient();
  const toolCallLog = [];
  let lastToolData;

  try {
    const messages = [...sanitizeHistory(history).slice(-6), { role: "user", content: question }];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(),
        messages,
        tools: commerceTools,
        tool_choice: { type: "auto" },
      });

      const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");

      if (toolUseBlocks.length === 0) {
        const textBlock = response.content.find((block) => block.type === "text");
        const answer = textBlock?.text?.trim();

        if (!answer) {
          throw new Error("Claude returned no text and no tool use.");
        }

        return buildResponse({ toolCalls: toolCallLog, answer, data: lastToolData });
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResultContent = [];

      for (const block of toolUseBlocks) {
        const normalizedInput = normalizeSelectedToolArgs(question, block.name, block.input);
        const toolResult = await runCommerceTool(block.name, normalizedInput, context);
        toolCallLog.push({ name: block.name, args: normalizedInput, source: toolResult.source });
        lastToolData = toolResult.data;

        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(toolResult.data),
        });
      }

      messages.push({ role: "user", content: toolResultContent });
    }

    throw new Error("Exceeded max tool-call turns without a final answer.");
  } catch (error) {
    console.error("Claude tool flow failed, falling back to deterministic router:", error);
    const intent = routeIntent(question);
    const toolResult = await runCommerceTool(intent.toolName, intent.args, context);

    return buildResponse({
      toolCalls: [...toolCallLog, { name: intent.toolName, args: intent.args, source: toolResult.source }],
      answer: formatDeterministicAnswer(intent.toolName, toolResult),
      data: toolResult.data,
    });
  }
}

function buildSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);

  return `You are an admin assistant for an ecommerce operations team, backed by live Adobe Commerce data. Current date: ${today}.

You may call as many of the approved tools as needed, in sequence, to fully answer the question — you are not limited to one tool call per question. Chain tool calls when a question needs more than one lookup (for example: find a customer's profile, then their orders; or list orders, then check a specific order's shipment).

Tool selection guidance: Extract order numbers exactly, including leading zeros. Use listPurchasedProductsByCustomer for questions asking what products, SKUs, or items a named customer bought/purchased/ordered, including date phrases like by 20th April. Use countOrdersByCustomer for questions like total number of orders for/of/by/made by a named customer. Use listOrdersByCustomer for questions like all/list/show orders for/of/by/made by a named customer. Use listOrders for broad recent/all/status-filtered order requests with no customer name — pass status (e.g. pending, processing, complete, canceled, closed, holded) for status-wise questions, fromDate/toDate/sortField/sortDirection (e.g. sortField=grand_total, sortDirection=DESC) for highest/lowest order value questions, olderThanHours with status=processing for "stuck in processing" questions, couponCode to find which order(s) used a specific coupon code, and couponUsedOnly=true (limit 1, default sort) for "last/most recent coupon usage" questions — the returned orders include couponCode and region fields, so this also answers "was a coupon used on this order" or "which region was this order from" once you have order details. Use getOrderStatus for a specific order. Use getShipmentStatus for shipment, delivery, carrier, or tracking questions. Use getReturnStatus for a single return/RMA by ID or order number; use rmaSummary for any aggregate/count/breakdown RMA question instead (weekly counts, pending count, delayed RMAs, top return reasons, most-returned SKUs, orders with multiple RMAs) — read its dataNotes and report the stated limitations honestly rather than inventing a turnaround time or customer identity it doesn't have. Use topSellingProducts for best sellers (default) or worst sellers (sortDirection=ASC) — it only ranks products that sold at least once; for "haven't sold in N days" / zero-sales products, use unsoldProducts instead. Use salesSummary for revenue/order/AOV/promo-% totals over a window — pass matching fromDate and toDate (today's date for both) for "today" questions. Use topCustomers for "top N customers" questions. Use ordersByRegion for store/website region breakdowns of orders; use customersByLocation for shipping country/city breakdowns instead — these are different dimensions (store region vs. shipping address). Use couponRevenue for revenue or per-customer usage on one specific coupon code (combine with queryCommerceApi on /coupons/search for usage_limit/usage_per_customer to check whether a customer exceeded their allowed uses). Use getStockStatus for a single named SKU's quantity, in-stock state, low-stock threshold, and which regions/websites it's enabled in — it cannot scan the whole catalog for OOS SKUs. Use getProductDetails when a specific SKU is given for price/status/type/manufacturer/categories/Ingram Part Number. Use searchProducts for product name/keyword lookups without a SKU. Use getCustomerDetails for questions about a customer's profile, email, or account (not their orders). Use listInvoicesForOrder for invoice questions on an order. Use getCreditMemoStatus for credit memo or refund-record questions on an order. Use getStoreConfig for store-level settings like base currency, timezone, locale, or base URL. Use getIngramConfiguration for questions about Ingram Micro integration *settings* — for whether a specific *order* synced to Ingram use getIngramOrderStatus, and for scanning recent orders for Ingram sync problems use ingramSyncIssues; for a product's Ingram Part *Number* use getProductDetails, not either Ingram tool. Use dailySalesTrend for day-by-day revenue/order trend questions. Use salesBreakdown (dimension=category|brand|paymentMethod) for "sales by X" questions. Use customerActivitySummary for new-vs-returning-customer questions. Use catalogQualityReport for catalog data-quality questions (disabled products, missing images/descriptions/categories) — this catalog is small enough that it's a full scan, say so if asked whether it's a sample.

Real order status values on this store (use exactly): pending, processing, complete, closed, canceled, preorder, esw_order_canceling (an order actively being canceled through the ESW cross-border checkout flow). There is no fraud-check or manual-review status or flag anywhere in this data — if asked about fraud/manual-review orders, say plainly that Commerce doesn't track that here rather than guessing from another status. Real payment methods: eshopworld, eshopworld_zero_value, cashondelivery, free.

For "today vs yesterday," "this week vs last week," "month-to-date," "year-to-date," or similar comparison/dashboard questions, there is no single comparison tool — call salesSummary (or dailySalesTrend, topCustomers, etc.) twice with the two different date ranges you compute yourself from the current date, then compare the two results in your answer. The same pattern applies to comparing any metric period-over-period.

If none of the named tools fit but the question is plausibly about Commerce data (promotions/cart price rules, coupons, customer groups, categories, or another read-only area), use queryCommerceApi against an allowed endpoint instead of guessing. Never call queryCommerceApi with an endpoint outside the areas it describes.

Known gaps — say so plainly rather than guessing or calling an unrelated tool: no tool can scan the whole catalog for out-of-stock/at-risk SKUs or compute OOS ratio by country (only single-SKU lookups via getStockStatus exist); no tool has product price-change history or Ingram back-order delay data (Ingram Part Number and order sync status ARE available, via getProductDetails/getIngramOrderStatus/ingramSyncIssues — don't say these are unavailable); nothing here covers web analytics (conversion rate, cart abandonment, checkout drop-off, failed-payment spikes, device/browser/OS/acquisition-source breakdowns, search analytics), a payment gateway's own reporting (failure rates, chargebacks, disputes, settlements), a fraud-detection platform, marketing/ad-platform data (campaigns, ROAS, CPA, email/social/affiliate performance), carrier tracking data (shipment delays, lost/damaged shipments — Commerce only stores a tracking number, not delivery status), competitor pricing, customer support/ticketing data, or Commerce's own internal system/admin data (cron job status, indexer/cache status, admin login history, deployment history, API error rates, Elasticsearch health) — that last category is not just "not connected," it structurally isn't exposed by Commerce's public REST API at all, even in principle, so don't suggest configuring something to fix it. No tool can compute a real demand forecast, churn prediction, or run rate vs. forecast (you may only do a naive same-day linear projection from salesSummary data if asked, and must label it as a rough estimate, not a forecast or prediction). Cron/scheduled job execution history is also unavailable. Chart/graph rendering and CSV/Excel export are not implemented — if asked, say this is a text-only chat interface for now.

Once you have enough tool results, answer in concise, factual natural language. Never invent order, shipment, return, product, customer, configuration, or sales details that are not present in a tool result. If the question needs data no tool can reach, say so plainly and explain what's missing instead of guessing.`;
}

function sanitizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item?.content)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content),
    }));
}

function normalizeSelectedToolArgs(question, toolName, input) {
  const customerToolNames = new Set([
    "countOrdersByCustomer",
    "listOrdersByCustomer",
    "listPurchasedProductsByCustomer",
    "getCustomerDetails",
  ]);

  if (!customerToolNames.has(toolName)) {
    return input;
  }

  const fallbackIntent = routeIntent(question);
  const badCustomerNames = new Set(["had", "did", "by", "for", "of", "all", "order", "orders", "product", "products"]);
  const customerName = String(input.customerName || "").trim().toLowerCase();

  if (
    fallbackIntent.args?.customerName &&
    (!customerName || badCustomerNames.has(customerName) || customerName.length < 2)
  ) {
    return { ...input, ...fallbackIntent.args };
  }

  return input;
}

function buildResponse({ toolCalls, answer, data }) {
  const lastCall = toolCalls[toolCalls.length - 1] || null;

  return {
    answer,
    tool: lastCall,
    toolCalls,
    data,
  };
}

function formatDeterministicAnswer(toolName, toolResult) {
  const data = toolResult.data;

  if (toolName === "help") {
    return [
      "I can answer admin questions about:",
      "- Order status by order number",
      "- Recent order lists",
      "- Customer order counts",
      "- Customer order lists",
      "- Products purchased by customer",
      "- Shipment and tracking by order number",
      "- Return/RMA status",
      "- Top-selling products",
      "- Sales summaries by recent date range",
      "- Product details by SKU or keyword search",
      "- Customer profile lookup",
      "- Invoices and credit memos by order number",
      "- Store configuration (currency, timezone, locale, base URL)",
      "- Ingram / Ingram Micro configuration",
      "- Order status filtering (pending, processing, complete, canceled, etc.) and sorting by value or date",
      "- Other read-only Commerce data such as promotions, coupons, customer groups, or categories (best-effort)",
      "This deterministic mode is limited to matched phrasing. Configure ANTHROPIC_API_KEY for open-ended questions.",
    ].join("\n");
  }

  if (data?.error) {
    return data.error;
  }

  if (toolName === "getOrderStatus") {
    return `Order ${data.incrementId} is ${data.status}. Total: ${data.currency} ${data.grandTotal}. Customer: ${data.customerName}. Items: ${data.items
      .map((item) => `${item.sku} x${item.qty}`)
      .join(", ")}.`;
  }

  if (toolName === "listOrders") {
    if (!data.orders?.length) {
      return "No orders found.";
    }

    return `Recent orders: ${data.orders
      .map(
        (order) =>
          `${order.incrementId} - ${order.status} - ${order.currency} ${order.grandTotal} - ${order.customerName}`,
      )
      .join("; ")}.`;
  }

  if (toolName === "countOrdersByCustomer") {
    const sample = data.sampleOrders?.length
      ? ` Recent matches: ${data.sampleOrders
          .map((order) => `${order.incrementId} (${order.status}, ${order.currency} ${order.grandTotal})`)
          .join("; ")}.`
      : "";

    return `${data.customerName} has ${data.totalOrders} matching order(s).${sample}`;
  }

  if (toolName === "listOrdersByCustomer") {
    if (!data.orders?.length) {
      return `No exact customer-name order matches found for ${data.customerName}.`;
    }

    return `Exact customer-name matches for ${data.customerName}: ${data.orders
      .map(
        (order) =>
          `${order.incrementId} - ${order.status} - ${order.currency} ${order.grandTotal} - ${order.customerName}`,
      )
      .join("; ")}. Total matching orders: ${data.totalOrders}.`;
  }

  if (toolName === "listPurchasedProductsByCustomer") {
    if (!data.products?.length) {
      const dateContext = data.toDate ? ` by ${data.toDate}` : "";
      return `No purchased products found for exact customer-name match ${data.customerName}${dateContext}.`;
    }

    const dateContext = data.toDate ? ` by ${data.toDate}` : "";
    return `Products purchased by ${data.customerName}${dateContext}: ${data.products
      .map((product) => `${product.name} (${product.sku}) x${product.qtyPurchased}`)
      .join("; ")}. Based on ${data.ordersScanned} scanned order(s), ${data.totalOrdersMatched} matching order(s) total.`;
  }

  if (toolName === "getShipmentStatus") {
    if (!data.shipments?.length) {
      return `No shipments found for order ${data.orderIncrementId}.`;
    }

    return `Order ${data.orderIncrementId} has ${data.shipments.length} shipment(s): ${data.shipments
      .map((shipment) => `${shipment.carrier} ${shipment.trackingNumber} (${shipment.status})`)
      .join("; ")}.`;
  }

  if (toolName === "getReturnStatus") {
    return `Return ${data.rmaId} for order ${data.orderIncrementId} is ${data.status}. Reason: ${data.reason}. Items: ${data.items
      .map((item) => `${item.sku} x${item.qty}`)
      .join(", ")}.`;
  }

  if (toolName === "topSellingProducts") {
    return `Top-selling products for the last ${data.days} day(s): ${data.products
      .map((item, index) => `${index + 1}. ${item.name} (${item.sku}) - ${item.qtySold} units`)
      .join("; ")}.`;
  }

  if (toolName === "salesSummary") {
    return `Sales summary for the last ${data.days} day(s): ${data.orders} orders, ${data.currency} ${data.revenue} revenue, average order value ${data.currency} ${data.averageOrderValue}.`;
  }

  if (toolName === "getProductDetails") {
    return `${data.name} (${data.sku}) is ${data.status}. Price: ${data.price}. Type: ${data.typeId}.`;
  }

  if (toolName === "searchProducts") {
    if (!data.products?.length) {
      return `No products found matching "${data.keyword}".`;
    }

    return `Products matching "${data.keyword}": ${data.products
      .map((product) => `${product.name} (${product.sku}) - ${product.price} - ${product.status}`)
      .join("; ")}.`;
  }

  if (toolName === "getCustomerDetails") {
    return `${data.firstName} ${data.lastName} (${data.email}) - group ${data.groupId}, created ${data.createdAt}.`;
  }

  if (toolName === "listInvoicesForOrder") {
    if (!data.invoices?.length) {
      return `No invoices found for order ${data.orderIncrementId}.`;
    }

    return `Order ${data.orderIncrementId} has ${data.invoices.length} invoice(s): ${data.invoices
      .map((invoice) => `${invoice.invoiceId} - ${invoice.state} - ${invoice.grandTotal}`)
      .join("; ")}.`;
  }

  if (toolName === "getCreditMemoStatus") {
    if (!data.creditMemos?.length) {
      return `No credit memos found for order ${data.orderIncrementId}.`;
    }

    return `Order ${data.orderIncrementId} has ${data.creditMemos.length} credit memo(s): ${data.creditMemos
      .map((creditMemo) => `${creditMemo.creditMemoId} - ${creditMemo.state} - ${creditMemo.grandTotal}`)
      .join("; ")}.`;
  }

  if (toolName === "getStoreConfig") {
    return `Store configuration: base URL ${data.baseUrl}, base currency ${data.baseCurrencyCode}, display currency ${data.defaultDisplayCurrencyCode}, timezone ${data.timezone}, locale ${data.locale}.`;
  }

  if (toolName === "getIngramConfiguration") {
    return `Ingram configuration: ${Object.entries(data)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("; ")}.`;
  }

  return JSON.stringify(data);
}

// Claude tool definitions use input_schema instead of OpenAI's parameters wrapper
const commerceTools = [
  {
    name: "getOrderStatus",
    description: "Look up one Adobe Commerce order by increment ID/order number.",
    input_schema: {
      type: "object",
      properties: {
        orderIncrementId: {
          type: "string",
          description: "The order increment ID, preserving leading zeros. Example: 000008627.",
        },
      },
      required: ["orderIncrementId"],
    },
  },
  {
    name: "listOrders",
    description:
      "List Adobe Commerce orders with no customer name given. Supports filtering by status (pending, processing, complete, canceled, closed, holded, etc.), a date range, and sorting — use this for status-wise order lists and highest/lowest order value questions.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximum number of orders to return (1-20).",
        },
        status: {
          type: "string",
          description: "Optional order status to filter by, e.g. pending, processing, complete, canceled, closed, holded.",
        },
        fromDate: {
          type: "string",
          description: "Optional start date in YYYY-MM-DD format.",
        },
        toDate: {
          type: "string",
          description: "Optional end date in YYYY-MM-DD format.",
        },
        olderThanHours: {
          type: "number",
          description: "Optional. Only return orders created more than this many hours ago — combine with status for 'stuck in processing >N hours' questions.",
        },
        couponCode: {
          type: "string",
          description: "Optional exact coupon code. Returns orders that used this specific coupon code, most recent first by default — use this to find which order(s) used a given code.",
        },
        couponUsedOnly: {
          type: "boolean",
          description: "Optional. Set true (with no couponCode) to return only orders where any coupon was applied, sorted by created_at DESC by default — use this for 'last coupon usage' / 'most recent order with a coupon' questions.",
        },
        sortField: {
          type: "string",
          description: "Field to sort by, e.g. created_at or grand_total. Defaults to created_at.",
        },
        sortDirection: {
          type: "string",
          description: "ASC or DESC. Defaults to DESC. Use DESC with sortField grand_total for highest-value orders.",
        },
      },
    },
  },
  {
    name: "getShipmentStatus",
    description: "Look up shipments and tracking for one order by order increment ID.",
    input_schema: {
      type: "object",
      properties: {
        orderIncrementId: {
          type: "string",
          description: "The order increment ID, preserving leading zeros.",
        },
      },
      required: ["orderIncrementId"],
    },
  },
  {
    name: "listOrdersByCustomer",
    description:
      "List Adobe Commerce orders with an exact customer first name, last name, or full name match. Use this when a customer name is included.",
    input_schema: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Customer name from the admin's question. Example: Rahul.",
        },
        limit: {
          type: "integer",
          description: "Number of matching orders to return (1-20).",
        },
      },
      required: ["customerName"],
    },
  },
  {
    name: "countOrdersByCustomer",
    description: "Count Adobe Commerce orders with an exact customer first name, last name, or full name match.",
    input_schema: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Customer name from the admin's question. Example: Anirudh.",
        },
        limit: {
          type: "integer",
          description: "Number of sample matching orders to return (1-20).",
        },
      },
      required: ["customerName"],
    },
  },
  {
    name: "listPurchasedProductsByCustomer",
    description:
      "List products, SKUs, and quantities purchased by an exact customer first name, last name, or full name match. Supports optional date limits such as by 20th April.",
    input_schema: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Customer name from the admin's question. Example: Rahul.",
        },
        fromDate: {
          type: "string",
          description: "Optional start date in YYYY-MM-DD format.",
        },
        toDate: {
          type: "string",
          description: "Optional end date in YYYY-MM-DD format. For 'by 20th April' use current year unless a year is provided.",
        },
        limit: {
          type: "integer",
          description: "Number of matching orders to scan (1-20).",
        },
      },
      required: ["customerName"],
    },
  },
  {
    name: "getReturnStatus",
    description: "Look up return/RMA status by RMA ID or order increment ID.",
    input_schema: {
      type: "object",
      properties: {
        rmaId: {
          type: "string",
          description: "RMA ID if provided by the admin.",
        },
        orderIncrementId: {
          type: "string",
          description: "Order increment ID if the admin asks about a return for an order.",
        },
      },
    },
  },
  {
    name: "topSellingProducts",
    description: "Return best- or worst-selling products (by quantity sold) for a recent time window. Use sortDirection=ASC for 'fewest units sold' / worst-seller questions — this only ranks products with at least one sale; use unsoldProducts for products with zero sales.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Number of recent days to inspect (1-90).",
        },
        limit: {
          type: "integer",
          description: "Maximum number of products to return (1-20).",
        },
        sortDirection: {
          type: "string",
          description: "DESC (default, best sellers) or ASC (worst sellers, lowest quantity sold first).",
        },
      },
    },
  },
  {
    name: "unsoldProducts",
    description: "List enabled, sellable (non-configurable) products with zero sales in a time window — use for 'haven't sold in N days' questions. Different from topSellingProducts sortDirection=ASC, which only ranks products that sold at least once.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days to check for zero sales (1-90). Defaults to 30." },
        limit: { type: "integer", description: "Max SKUs to return (1-100). Defaults to 20." },
      },
    },
  },
  {
    name: "salesSummary",
    description:
      "Return order count, revenue, average order value, and promotion usage (count/revenue/% of orders with a coupon) for a time window. Use fromDate=toDate=today's date for 'today' questions, or days for a rolling window.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Number of recent days to summarize (1-90). Ignored if fromDate/toDate given.",
        },
        fromDate: {
          type: "string",
          description: "Optional start date in YYYY-MM-DD format. Use with toDate for an exact range, e.g. today's date for both to summarize just today.",
        },
        toDate: {
          type: "string",
          description: "Optional end date in YYYY-MM-DD format.",
        },
        status: {
          type: "string",
          description: "Optional order status filter, e.g. complete, processing.",
        },
        couponCode: {
          type: "string",
          description: "Optional exact coupon code to scope the summary to orders using that code (for 'revenue driven by coupon X').",
        },
      },
    },
  },
  {
    name: "topCustomers",
    description: "Rank customers by order count or revenue over a time window — use for 'top N customers' questions.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days to inspect (1-90). Ignored if fromDate/toDate given." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
        limit: { type: "integer", description: "Number of top customers to return (1-20)." },
        metric: { type: "string", description: "'revenue' (default) or 'orderCount' — which metric to rank by." },
      },
    },
  },
  {
    name: "ordersByRegion",
    description: "Break down order count and revenue by store/region (e.g. US, CA, DE, FR, UK) over a time window.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days to inspect (1-90). Ignored if fromDate/toDate given." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
      },
    },
  },
  {
    name: "couponRevenue",
    description:
      "Return total revenue, order count, and per-customer usage breakdown (including customers who used a coupon more than once) for one specific coupon code over a time window. Combine with queryCommerceApi on /coupons/search (for usage_limit/usage_per_customer) to check whether any customer exceeded their allowed uses.",
    input_schema: {
      type: "object",
      properties: {
        couponCode: { type: "string", description: "The exact coupon code." },
        days: { type: "integer", description: "Number of recent days to inspect (1-90, default 90). Ignored if fromDate/toDate given." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
      },
      required: ["couponCode"],
    },
  },
  {
    name: "getStockStatus",
    description:
      "Look up a SKU's stock quantity, in-stock/out-of-stock state, low-stock threshold, and which regions/websites it's enabled in. Use for stock/OOS and 'enabled in which regions' questions about one named SKU. Not usable for catalog-wide OOS scans — only single-SKU lookups are supported.",
    input_schema: {
      type: "object",
      properties: {
        sku: { type: "string", description: "The exact product SKU." },
      },
      required: ["sku"],
    },
  },
  {
    name: "rmaSummary",
    description:
      "Aggregate RMA/return records: counts by status and region, top returned SKUs, return-reason breakdown, RMAs open longer than a threshold (approximates 'delayed'/SLA), and orders with more than one RMA. Use for any aggregate RMA question (weekly counts, pending count, delayed RMAs, top reasons, most-returned SKUs). Does not provide true turnaround time or customer identity — see the response's dataNotes for exact limitations, and report them plainly if asked.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days to inspect, based on date_requested. Omit for all-time/current snapshot." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
        status: { type: "string", description: "Optional exact status filter, e.g. pending, authorized, received." },
        region: { type: "string", description: "Optional store_code substring filter, e.g. us, ca, ca_fr." },
        slaThresholdDays: { type: "integer", description: "Days an unresolved RMA can be open before being flagged as delayed. Defaults to 7." },
      },
    },
  },
  {
    name: "dailySalesTrend",
    description: "Return day-by-day order count and revenue for a recent window — use for revenue trend/chart questions.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days to break down (1-90). Defaults to 30." },
      },
    },
  },
  {
    name: "salesBreakdown",
    description: "Group revenue and quantity by category, brand (manufacturer), or payment method over a time window — use for 'sales by X' questions.",
    input_schema: {
      type: "object",
      properties: {
        dimension: { type: "string", description: "'category', 'brand', or 'paymentMethod'." },
        days: { type: "integer", description: "Number of recent days (1-90). Ignored if fromDate/toDate given." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
        limit: { type: "integer", description: "Max groups to return (1-20). Defaults to 10." },
      },
      required: ["dimension"],
    },
  },
  {
    name: "customerActivitySummary",
    description: "Return new-customer-account count, returning-customer count, and guest-order count for a time window — use for 'new vs returning customers' questions. 'New' means the Commerce account itself was created in the window, not just their first order.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days (1-90). Ignored if fromDate/toDate given. Use 1 for 'today'." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
      },
    },
  },
  {
    name: "catalogQualityReport",
    description: "Scan the catalog for disabled products, missing images, missing descriptions, and products with no category assigned. This store's catalog is small (~150 products) so this is a full scan, not a sample.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "getIngramOrderStatus",
    description: "Look up one order's Ingram fulfillment sync history (queued/synced/rejected), derived from its Commerce order status history log.",
    input_schema: {
      type: "object",
      properties: {
        orderIncrementId: { type: "string", description: "The order increment ID, preserving leading zeros." },
      },
      required: ["orderIncrementId"],
    },
  },
  {
    name: "ingramSyncIssues",
    description: "Scan recent orders for Ingram fulfillment sync problems: rejected/canceled-by-Ingram orders, and orders still queued with no sync confirmation yet.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Number of recent days to scan (1-90). Defaults to 7." },
        limit: { type: "integer", description: "Max issues to return (1-20)." },
      },
    },
  },
  {
    name: "customersByLocation",
    description: "Break down orders by shipping country or city over a time window — use for 'customers by country/city' questions.",
    input_schema: {
      type: "object",
      properties: {
        dimension: { type: "string", description: "'country' (default) or 'city'." },
        days: { type: "integer", description: "Number of recent days (1-90). Ignored if fromDate/toDate given." },
        fromDate: { type: "string", description: "Optional start date YYYY-MM-DD." },
        toDate: { type: "string", description: "Optional end date YYYY-MM-DD." },
      },
    },
  },
  {
    name: "getProductDetails",
    description: "Look up one product by SKU: price, status, type, manufacturer/brand, categories, and Ingram Part Number.",
    input_schema: {
      type: "object",
      properties: {
        sku: {
          type: "string",
          description: "The exact product SKU.",
        },
      },
      required: ["sku"],
    },
  },
  {
    name: "searchProducts",
    description: "Search products by name or keyword when no SKU is given.",
    input_schema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Product name or keyword to search for.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of matching products to return (1-20).",
        },
      },
      required: ["keyword"],
    },
  },
  {
    name: "getCustomerDetails",
    description: "Look up a customer's profile (email, name, group, created date), not their orders.",
    input_schema: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Customer first, last, or full name.",
        },
        email: {
          type: "string",
          description: "Customer email address, if known.",
        },
      },
    },
  },
  {
    name: "listInvoicesForOrder",
    description: "List invoices for one order by order increment ID.",
    input_schema: {
      type: "object",
      properties: {
        orderIncrementId: {
          type: "string",
          description: "The order increment ID, preserving leading zeros.",
        },
      },
      required: ["orderIncrementId"],
    },
  },
  {
    name: "getCreditMemoStatus",
    description: "List credit memos/refund records for one order by order increment ID.",
    input_schema: {
      type: "object",
      properties: {
        orderIncrementId: {
          type: "string",
          description: "The order increment ID, preserving leading zeros.",
        },
      },
      required: ["orderIncrementId"],
    },
  },
  {
    name: "getStoreConfig",
    description: "Return store-level configuration: base currency, display currency, timezone, locale, base URL.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "getIngramConfiguration",
    description: "Return Ingram / Ingram Micro configuration and report settings.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "queryCommerceApi",
    description:
      "Fallback for read-only Commerce data not covered by another tool, such as promotions/cart price rules (/salesRules/search), coupons (/coupons/search), customer groups (/customerGroups/search), or categories (/categories). Only use this when no other named tool fits — never guess an endpoint outside orders, invoices, shipments, credit memos, products, categories, customers, customer groups, sales rules, coupons, store, directory, countries, rma-aging-report, or seagate/chatbot.",
    input_schema: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Adobe Commerce REST V1 path, e.g. /salesRules/search, /coupons/search, /customerGroups/search, /categories.",
        },
        filters: {
          type: "array",
          description: "Optional AND-combined filters.",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              value: { type: "string" },
              condition: { type: "string", description: "eq, gteq, lteq, like, neq, etc. Defaults to eq." },
            },
            required: ["field", "value"],
          },
        },
        pageSize: {
          type: "integer",
          description: "Maximum results to return (1-20).",
        },
        sortField: {
          type: "string",
        },
        sortDirection: {
          type: "string",
          description: "ASC or DESC.",
        },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "help",
    description: "Explain what questions the assistant can answer.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];
