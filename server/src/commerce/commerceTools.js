import {
  commerceRestPath,
  fetchAdobeCommerceJson,
  hasAdobeCommerceConfig,
  searchCriteria,
} from "./adobeCommerceClient.js";
import { mockOrders, mockReturns, mockShipments, mockTopProducts } from "./mockData.js";

const MAX_DAYS = 90;
const MAX_LIMIT = 20;

export async function runCommerceTool(toolName, args) {
  const tools = {
    getOrderStatus,
    listOrders,
    listOrdersByCustomer,
    countOrdersByCustomer,
    listPurchasedProductsByCustomer,
    getShipmentStatus,
    getReturnStatus,
    topSellingProducts,
    salesSummary,
    help: async () => ({ source: "system", data: {} }),
  };

  const tool = tools[toolName] || tools.help;
  return tool(args || {});
}

async function getOrderStatus({ orderIncrementId }) {
  if (!orderIncrementId) {
    return missing("Please provide an order number, for example 100000123.");
  }

  if (hasAdobeCommerceConfig()) {
    const criteria = searchCriteria([{ field: "increment_id", value: orderIncrementId }]);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${criteria}`);
    const order = payload.items?.[0];

    if (!order) {
      return missing(`No order found for ${orderIncrementId}.`);
    }

    return {
      source: "adobe-commerce-rest",
      data: {
        entityId: order.entity_id,
        incrementId: order.increment_id,
        status: order.status,
        grandTotal: Number(order.grand_total || 0).toFixed(2),
        currency: order.order_currency_code,
        customerName: `${order.customer_firstname || ""} ${order.customer_lastname || ""}`.trim() || "Guest",
        createdAt: order.created_at,
        items: (order.items || [])
          .filter((item) => !item.parent_item_id)
          .map((item) => ({
            sku: item.sku,
            name: item.name,
            qty: Number(item.qty_ordered || 0),
          })),
      },
    };
  }

  const order = mockOrders.find((item) => item.incrementId === orderIncrementId);
  return order ? withMock(order) : missing(`No order found for ${orderIncrementId}.`);
}

async function listOrders({ limit = 10 }) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);

  if (hasAdobeCommerceConfig()) {
    const params = new URLSearchParams();
    params.set("searchCriteria[pageSize]", String(safeLimit));
    params.set("searchCriteria[currentPage]", "1");
    params.set("searchCriteria[sortOrders][0][field]", "created_at");
    params.set("searchCriteria[sortOrders][0][direction]", "DESC");

    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`);

    return {
      source: "adobe-commerce-rest",
      data: {
        orders: (payload.items || []).map(mapAdobeOrderSummary),
      },
    };
  }

  return {
    source: "mock",
    data: {
      orders: mockOrders.slice(0, safeLimit).map((order) => ({
        incrementId: order.incrementId,
        status: order.status,
        grandTotal: Number(order.grandTotal).toFixed(2),
        currency: order.currency,
        customerName: order.customerName,
        createdAt: order.createdAt,
      })),
    },
  };
}

async function countOrdersByCustomer({ customerName, limit = 5 }) {
  const result = await findOrdersByCustomer({ customerName, limit });

  return {
    source: result.source,
    data: {
      customerName: result.data.customerName,
      matchType: result.data.matchType,
      totalOrders: result.data.totalOrders,
      sampleOrders: result.data.orders,
    },
  };
}

async function listOrdersByCustomer({ customerName, limit = 10 }) {
  return findOrdersByCustomer({ customerName, limit });
}

async function listPurchasedProductsByCustomer({ customerName, toDate = null, fromDate = null, limit = 20 }) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const name = String(customerName || "").trim();

  if (!name) {
    return missing("Please provide a customer name.");
  }

  if (hasAdobeCommerceConfig()) {
    const params = buildCustomerOrderSearchParams(name, safeLimit, { toDate, fromDate });
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`);
    const orders = payload.items || [];

    return {
      source: "adobe-commerce-rest",
      data: {
        customerName: name,
        matchType: "exact_first_or_last_name",
        fromDate,
        toDate,
        totalOrdersMatched: Number(payload.total_count || 0),
        ordersScanned: orders.length,
        products: aggregateOrderProducts(orders),
      },
    };
  }

  const normalizedName = name.toLowerCase();
  const matchingOrders = mockOrders.filter((order) =>
    order.customerName
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part === normalizedName),
  );

  return {
    source: "mock",
    data: {
      customerName: name,
      matchType: "exact_first_or_last_name",
      fromDate,
      toDate,
      totalOrdersMatched: matchingOrders.length,
      ordersScanned: matchingOrders.length,
      products: aggregateMockOrderProducts(matchingOrders),
    },
  };
}

async function findOrdersByCustomer({ customerName, limit = 10 }) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const name = String(customerName || "").trim();

  if (!name) {
    return missing("Please provide a customer name.");
  }

  if (hasAdobeCommerceConfig()) {
    const params = buildCustomerOrderSearchParams(name, safeLimit);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`);

    return {
      source: "adobe-commerce-rest",
      data: {
        customerName: name,
        matchType: "exact_first_or_last_name",
        totalOrders: Number(payload.total_count || 0),
        orders: (payload.items || []).map(mapAdobeOrderSummary),
      },
    };
  }

  const normalizedName = name.toLowerCase();
  const matchingOrders = mockOrders.filter((order) =>
    order.customerName
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part === normalizedName),
  );

  return {
    source: "mock",
    data: {
      customerName: name,
      matchType: "exact_first_or_last_name",
      totalOrders: matchingOrders.length,
      orders: matchingOrders.slice(0, safeLimit).map((order) => ({
        incrementId: order.incrementId,
        status: order.status,
        grandTotal: Number(order.grandTotal).toFixed(2),
        currency: order.currency,
        customerName: order.customerName,
        createdAt: order.createdAt,
      })),
    },
  };
}

async function getShipmentStatus({ orderIncrementId }) {
  if (!orderIncrementId) {
    return missing("Please provide an order number to look up shipments.");
  }

  if (hasAdobeCommerceConfig()) {
    const orderResult = await getOrderStatus({ orderIncrementId });
    const entityId = orderResult.data?.entityId;

    if (!entityId) {
      return {
        source: orderResult.source,
        data: {
          orderIncrementId,
          shipments: [],
        },
      };
    }

    const criteria = searchCriteria([{ field: "order_id", value: entityId }]);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/shipment")}?${criteria}`);

    return {
      source: "adobe-commerce-rest",
      data: {
        orderIncrementId,
        shipments: (payload.items || []).map((shipment) => ({
          shipmentId: String(shipment.entity_id),
          carrier: shipment.tracks?.[0]?.title || "Unknown carrier",
          trackingNumber: shipment.tracks?.[0]?.track_number || "No tracking number",
          status: "created",
          shippedAt: shipment.created_at,
        })),
      },
    };
  }

  return {
    source: "mock",
    data: {
      orderIncrementId,
      shipments: mockShipments.filter((item) => item.orderIncrementId === orderIncrementId),
    },
  };
}

async function getReturnStatus({ rmaId, orderIncrementId }) {
  const rma = mockReturns.find(
    (item) =>
      (rmaId && item.rmaId.toLowerCase() === rmaId.toLowerCase()) ||
      (orderIncrementId && item.orderIncrementId === orderIncrementId),
  );

  if (!rma) {
    return missing("No return found. Provide an RMA ID like RMA-9001 or an order number with a return.");
  }

  return withMock(rma);
}

async function topSellingProducts({ days = 30, limit = 5 }) {
  const safeDays = clamp(Number(days), 1, MAX_DAYS);
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);

  return {
    source: "mock",
    data: {
      days: safeDays,
      products: mockTopProducts.slice(0, safeLimit),
    },
  };
}

async function salesSummary({ days = 30 }) {
  const safeDays = clamp(Number(days), 1, MAX_DAYS);
  const revenue = mockOrders.reduce((sum, order) => sum + order.grandTotal, 0);
  const orders = mockOrders.length;

  return {
    source: "mock",
    data: {
      days: safeDays,
      orders,
      revenue: revenue.toFixed(2),
      averageOrderValue: (revenue / orders).toFixed(2),
      currency: "USD",
    },
  };
}

function withMock(data) {
  return {
    source: "mock",
    data,
  };
}

function missing(error) {
  const isMock = !hasAdobeCommerceConfig();

  return {
    source: isMock ? "mock" : "adobe-commerce-rest",
    data: {
      error: isMock
        ? `${error} The chatbot is currently using mock data, not staging. Configure ADOBE_COMMERCE_BASE_URL and ADOBE_COMMERCE_ADMIN_TOKEN in server/.env to search staging orders.`
        : error,
    },
  };
}

function mapAdobeOrderSummary(order) {
  return {
    incrementId: order.increment_id,
    status: order.status,
    grandTotal: Number(order.grand_total || 0).toFixed(2),
    currency: order.order_currency_code,
    customerName: `${order.customer_firstname || ""} ${order.customer_lastname || ""}`.trim() || "Guest",
    createdAt: order.created_at,
  };
}

function buildCustomerOrderSearchParams(customerName, limit, dateRange = {}) {
  const params = new URLSearchParams();
  const parts = customerName.split(/\s+/).filter(Boolean);

  params.set("searchCriteria[pageSize]", String(limit));
  params.set("searchCriteria[currentPage]", "1");
  params.set("searchCriteria[sortOrders][0][field]", "created_at");
  params.set("searchCriteria[sortOrders][0][direction]", "DESC");

  if (parts.length >= 2) {
    params.set("searchCriteria[filter_groups][0][filters][0][field]", "customer_firstname");
    params.set("searchCriteria[filter_groups][0][filters][0][value]", parts[0]);
    params.set("searchCriteria[filter_groups][0][filters][0][condition_type]", "eq");
    params.set("searchCriteria[filter_groups][1][filters][0][field]", "customer_lastname");
    params.set("searchCriteria[filter_groups][1][filters][0][value]", parts.slice(1).join(" "));
    params.set("searchCriteria[filter_groups][1][filters][0][condition_type]", "eq");
    appendDateFilters(params, 2, dateRange);

    return params;
  }

  params.set("searchCriteria[filter_groups][0][filters][0][field]", "customer_firstname");
  params.set("searchCriteria[filter_groups][0][filters][0][value]", customerName);
  params.set("searchCriteria[filter_groups][0][filters][0][condition_type]", "eq");
  params.set("searchCriteria[filter_groups][0][filters][1][field]", "customer_lastname");
  params.set("searchCriteria[filter_groups][0][filters][1][value]", customerName);
  params.set("searchCriteria[filter_groups][0][filters][1][condition_type]", "eq");
  appendDateFilters(params, 1, dateRange);

  return params;
}

function appendDateFilters(params, startGroupIndex, dateRange) {
  let groupIndex = startGroupIndex;

  if (dateRange.fromDate) {
    params.set(`searchCriteria[filter_groups][${groupIndex}][filters][0][field]`, "created_at");
    params.set(`searchCriteria[filter_groups][${groupIndex}][filters][0][value]`, `${dateRange.fromDate} 00:00:00`);
    params.set(`searchCriteria[filter_groups][${groupIndex}][filters][0][condition_type]`, "gteq");
    groupIndex += 1;
  }

  if (dateRange.toDate) {
    params.set(`searchCriteria[filter_groups][${groupIndex}][filters][0][field]`, "created_at");
    params.set(`searchCriteria[filter_groups][${groupIndex}][filters][0][value]`, `${dateRange.toDate} 23:59:59`);
    params.set(`searchCriteria[filter_groups][${groupIndex}][filters][0][condition_type]`, "lteq");
  }
}

function aggregateOrderProducts(orders) {
  const productsBySku = new Map();

  orders.forEach((order) => {
    (order.items || [])
      .filter((item) => !item.parent_item_id)
      .forEach((item) => {
        const sku = item.sku || "unknown";
        const existing = productsBySku.get(sku) || {
          sku,
          name: item.name || sku,
          qtyPurchased: 0,
          orderCount: 0,
          orderIncrementIds: [],
        };

        existing.qtyPurchased += Number(item.qty_ordered || 0);
        existing.orderCount += 1;
        existing.orderIncrementIds.push(order.increment_id);
        productsBySku.set(sku, existing);
      });
  });

  return [...productsBySku.values()].sort((left, right) => right.qtyPurchased - left.qtyPurchased);
}

function aggregateMockOrderProducts(orders) {
  const productsBySku = new Map();

  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const existing = productsBySku.get(item.sku) || {
        sku: item.sku,
        name: item.name,
        qtyPurchased: 0,
        orderCount: 0,
        orderIncrementIds: [],
      };

      existing.qtyPurchased += Number(item.qty || 0);
      existing.orderCount += 1;
      existing.orderIncrementIds.push(order.incrementId);
      productsBySku.set(item.sku, existing);
    });
  });

  return [...productsBySku.values()].sort((left, right) => right.qtyPurchased - left.qtyPurchased);
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.max(min, Math.min(value, max));
}
