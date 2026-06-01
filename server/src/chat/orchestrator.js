import Anthropic from "@anthropic-ai/sdk";
import { routeIntent } from "./intentRouter.js";
import { runCommerceTool } from "../commerce/commerceTools.js";

const DEFAULT_MODEL = "claude-opus-4-8";

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function answerQuestion({ question, history }) {
  if (process.env.ANTHROPIC_API_KEY) {
    return answerWithClaudeTools({ question, history });
  }

  const intent = routeIntent(question);
  const toolResult = await runCommerceTool(intent.toolName, intent.args);

  return buildResponse({
    toolName: intent.toolName,
    args: intent.args,
    toolResult,
    answer: formatDeterministicAnswer(intent.toolName, toolResult),
  });
}

async function answerWithClaudeTools({ question, history }) {
  try {
    const selectedTool = await selectCommerceTool({ question, history });
    const toolResult = await runCommerceTool(selectedTool.name, selectedTool.input);
    const answer = await summarizeToolResult({ question, history, selectedTool, toolResult });

    return buildResponse({
      toolName: selectedTool.name,
      args: selectedTool.input,
      toolResult,
      answer,
    });
  } catch (error) {
    console.error("Claude tool flow failed, falling back to deterministic router:", error);
    const intent = routeIntent(question);
    const toolResult = await runCommerceTool(intent.toolName, intent.args);

    return buildResponse({
      toolName: intent.toolName,
      args: intent.args,
      toolResult,
      answer: formatDeterministicAnswer(intent.toolName, toolResult),
    });
  }
}

async function selectCommerceTool({ question, history }) {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system: `You choose exactly one approved ecommerce tool for an admin question. Current date: ${new Date()
      .toISOString()
      .slice(0, 10)}. Extract order numbers exactly, including leading zeros. Prefer real lookup tools over help. Use listPurchasedProductsByCustomer for questions asking what products, SKUs, or items a named customer bought/purchased/ordered, including date phrases like by 20th April. Use countOrdersByCustomer for questions like total number of orders for/of/by/made by a named customer. Use listOrdersByCustomer for questions like all/list/show orders for/of/by/made by a named customer. Use listOrders only for broad recent/all order requests with no customer name. Use getOrderStatus for a specific order. Use getShipmentStatus for shipment, delivery, carrier, or tracking questions. Use getReturnStatus for returns, refunds, or RMA questions. Use topSellingProducts for best sellers. Use salesSummary for revenue/order totals.`,
    messages: [
      ...sanitizeHistory(history).slice(-6),
      { role: "user", content: question },
    ],
    tools: commerceTools,
    tool_choice: { type: "any" },
  });

  const toolUseBlock = response.content.find((block) => block.type === "tool_use");

  if (!toolUseBlock) {
    const fallbackIntent = routeIntent(question);
    return { name: fallbackIntent.toolName, input: fallbackIntent.args };
  }

  return {
    name: toolUseBlock.name,
    input: normalizeSelectedToolArgs(question, toolUseBlock.name, toolUseBlock.input),
  };
}

async function summarizeToolResult({ question, history, selectedTool, toolResult }) {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system:
      "You are an admin assistant for an ecommerce operations team. Answer only from the provided Commerce REST tool result. Be concise, factual, and mention missing data. Do not invent order, shipment, return, product, or sales details.",
    messages: [
      ...sanitizeHistory(history).slice(-6),
      {
        role: "user",
        content: `Question: ${question}\n\nTool used: ${selectedTool.name}\nTool arguments: ${JSON.stringify(
          selectedTool.input,
        )}\nTool source: ${toolResult.source}\nTool result JSON:\n${JSON.stringify(toolResult.data, null, 2)}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const content = textBlock?.text;

  if (!content || looksLikeJson(content)) {
    return formatDeterministicAnswer(selectedTool.name, toolResult);
  }

  return content;
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

function looksLikeJson(value) {
  const trimmed = String(value).trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function buildResponse({ toolName, args, toolResult, answer }) {
  return {
    answer,
    tool: {
      name: toolName,
      args,
      source: toolResult.source,
    },
    data: toolResult.data,
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
    description: "List the most recent Adobe Commerce orders.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximum number of recent orders to return (1-20).",
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
    description: "Return top-selling products for a recent time window.",
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
      },
    },
  },
  {
    name: "salesSummary",
    description: "Return sales order count and revenue summary for a recent time window.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Number of recent days to summarize (1-90).",
        },
      },
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
