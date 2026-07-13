import {
  buildSearchCriteriaParams,
  commerceRestPath,
  fetchAdobeCommerceJson,
  fetchIngramConfiguration,
  fetchRmaAgingReport,
  hasAdobeCommerceConfig,
  searchCriteria,
} from "./adobeCommerceClient.js";
import {
  mockCreditMemos,
  mockCustomers,
  mockIngramConfiguration,
  mockInvoices,
  mockOrders,
  mockProducts,
  mockReturns,
  mockShipments,
  mockStoreConfig,
  mockTopProducts,
} from "./mockData.js";

const MAX_DAYS = 90;
const MAX_LIMIT = 20;

// context = { token } — the authenticated caller's own Commerce admin token, threaded through
// every REST call this tool makes so Commerce's own ACL applies to that specific admin's
// account. Absent (mock/dev paths) falls back to the shared token inside fetchAdobeCommerceJson.
export async function runCommerceTool(toolName, args, context = {}) {
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
    getProductDetails,
    searchProducts,
    getCustomerDetails,
    listInvoicesForOrder,
    getCreditMemoStatus,
    getStoreConfig,
    getIngramConfiguration,
    queryCommerceApi,
    topCustomers,
    ordersByRegion,
    couponRevenue,
    getStockStatus,
    rmaSummary,
    dailySalesTrend,
    salesBreakdown,
    customerActivitySummary,
    catalogQualityReport,
    getIngramOrderStatus,
    ingramSyncIssues,
    customersByLocation,
    unsoldProducts,
    help: async () => ({ source: "system", data: {} }),
  };

  const tool = tools[toolName] || tools.help;
  return tool(args || {}, context);
}

async function getOrderStatus({ orderIncrementId }, context = {}) {
  if (!orderIncrementId) {
    return missing("Please provide an order number, for example 100000123.");
  }

  if (hasAdobeCommerceConfig()) {
    const criteria = searchCriteria([{ field: "increment_id", value: orderIncrementId }]);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${criteria}`, {
      token: context.token,
    });
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
        couponCode: order.coupon_code || null,
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

async function listOrders(
  {
    limit = 10,
    status,
    fromDate,
    toDate,
    olderThanHours,
    couponCode,
    couponUsedOnly,
    sortField = "created_at",
    sortDirection = "DESC",
  },
  context = {},
) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);

  if (hasAdobeCommerceConfig()) {
    const filters = [];

    if (status) {
      filters.push({ field: "status", value: status, condition: "eq" });
    }

    if (fromDate) {
      filters.push({ field: "created_at", value: `${fromDate} 00:00:00`, condition: "gteq" });
    }

    if (toDate) {
      filters.push({ field: "created_at", value: `${toDate} 23:59:59`, condition: "lteq" });
    }

    if (olderThanHours) {
      const cutoff = new Date(Date.now() - Number(olderThanHours) * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      filters.push({ field: "created_at", value: cutoff, condition: "lteq" });
    }

    if (couponCode) {
      filters.push({ field: "coupon_code", value: couponCode, condition: "eq" });
    } else if (couponUsedOnly) {
      filters.push({ field: "coupon_code", value: "", condition: "notnull" });
    }

    const params = buildSearchCriteriaParams(filters, {
      pageSize: safeLimit,
      sortField,
      sortDirection: sortDirection === "ASC" ? "ASC" : "DESC",
    });

    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`, {
      token: context.token,
    });

    return {
      source: "adobe-commerce-rest",
      data: {
        orders: (payload.items || []).map(mapAdobeOrderSummary),
        totalCount: Number(payload.total_count || 0),
      },
    };
  }

  let orders = mockOrders;

  if (status) {
    const normalizedStatus = String(status).toLowerCase();
    orders = orders.filter((order) => order.status.toLowerCase() === normalizedStatus);
  }

  if (couponCode) {
    orders = orders.filter((order) => order.couponCode === couponCode);
  } else if (couponUsedOnly) {
    orders = orders.filter((order) => Boolean(order.couponCode));
  }

  return {
    source: "mock",
    data: {
      orders: orders.slice(0, safeLimit).map((order) => ({
        incrementId: order.incrementId,
        status: order.status,
        grandTotal: Number(order.grandTotal).toFixed(2),
        currency: order.currency,
        customerName: order.customerName,
        createdAt: order.createdAt,
        couponCode: order.couponCode || null,
      })),
      totalCount: orders.length,
    },
  };
}

async function countOrdersByCustomer({ customerName, limit = 5 }, context = {}) {
  const result = await findOrdersByCustomer({ customerName, limit }, context);

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

async function listOrdersByCustomer({ customerName, limit = 10 }, context = {}) {
  return findOrdersByCustomer({ customerName, limit }, context);
}

async function listPurchasedProductsByCustomer({ customerName, toDate = null, fromDate = null, limit = 20 }, context = {}) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const name = String(customerName || "").trim();

  if (!name) {
    return missing("Please provide a customer name.");
  }

  if (hasAdobeCommerceConfig()) {
    const params = buildCustomerOrderSearchParams(name, safeLimit, { toDate, fromDate });
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`, {
      token: context.token,
    });
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

  const matchingOrders = mockOrders.filter((order) => matchesCustomerName(order.customerName, name));

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

async function findOrdersByCustomer({ customerName, limit = 10 }, context = {}) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const name = String(customerName || "").trim();

  if (!name) {
    return missing("Please provide a customer name.");
  }

  if (hasAdobeCommerceConfig()) {
    const params = buildCustomerOrderSearchParams(name, safeLimit);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`, {
      token: context.token,
    });

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

  const matchingOrders = mockOrders.filter((order) => matchesCustomerName(order.customerName, name));

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

async function getShipmentStatus({ orderIncrementId }, context = {}) {
  if (!orderIncrementId) {
    return missing("Please provide an order number to look up shipments.");
  }

  if (hasAdobeCommerceConfig()) {
    const orderResult = await getOrderStatus({ orderIncrementId }, context);
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
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/shipment")}?${criteria}`, {
      token: context.token,
    });

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

async function getReturnStatus({ rmaId, orderIncrementId }, context = {}) {
  if (!rmaId && !orderIncrementId) {
    return missing("Please provide an RMA ID like RMA-9001 or an order number with a return.");
  }

  if (hasAdobeCommerceConfig()) {
    try {
      const records = await fetchRmaAgingReport({ token: context.token });

      const match = (Array.isArray(records) ? records : []).find(
        (item) =>
          (rmaId && String(item.rma_number || "").toLowerCase() === rmaId.toLowerCase()) ||
          (orderIncrementId && item.order_increment_id === orderIncrementId),
      );

      if (!match) {
        return missing("No return found. Provide an RMA ID like RMA-9001 or an order number with a return.");
      }

      return {
        source: "adobe-commerce-rest",
        data: {
          rmaId: match.rma_number,
          orderIncrementId: match.order_increment_id,
          status: match.status,
          reason: match.reason,
          dateRequested: match.date_requested,
          delivered: match.delivered,
          items: (match.line_items || []).map((item) => ({ sku: item.sku, qty: item.qty })),
        },
      };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        return forbidden("Your Commerce account doesn't have permission to view returns/RMA data.");
      }
      console.error("RMA aging report lookup failed, falling back to mock return data:", error);
    }
  }

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

async function topSellingProducts({ days = 30, limit = 5, sortDirection = "DESC" }, context = {}) {
  const safeDays = clamp(Number(days), 1, MAX_DAYS);
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const ascending = String(sortDirection).toUpperCase() === "ASC";

  if (hasAdobeCommerceConfig()) {
    const { items: orders } = await fetchOrdersByFilters(
      { filters: resolveDateRangeFilters({ days: safeDays }) },
      context,
    );
    const sorted = aggregateOrderProducts(orders);
    const ordered = ascending ? [...sorted].reverse() : sorted;
    const products = ordered.slice(0, safeLimit).map((product) => ({
      sku: product.sku,
      name: product.name,
      qtySold: product.qtyPurchased,
    }));

    return {
      source: "adobe-commerce-rest",
      data: { days: safeDays, sortDirection: ascending ? "ASC" : "DESC", products },
    };
  }

  const mockOrdered = ascending ? [...mockTopProducts].reverse() : mockTopProducts;

  return {
    source: "mock",
    data: {
      days: safeDays,
      sortDirection: ascending ? "ASC" : "DESC",
      products: mockOrdered.slice(0, safeLimit),
    },
  };
}

// Products in the catalog with zero recorded sales in the window — a static, non-numeric
// enabled-catalog SKU list diffed against what actually sold, not a "lowest but >0" ranking.
async function unsoldProducts({ days = 30, limit = 20 }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Unsold-product lookup requires live Adobe Commerce access, which isn't configured yet.");
  }

  const safeDays = clamp(Number(days), 1, MAX_DAYS);
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT * 5);

  const [{ items: orders }, catalogPayload] = await Promise.all([
    fetchOrdersByFilters({ filters: resolveDateRangeFilters({ days: safeDays }) }, context),
    fetchAdobeCommerceJson(`${commerceRestPath("/products")}?searchCriteria[pageSize]=200`, { token: context.token }),
  ]);

  const soldSkus = new Set(aggregateOrderProducts(orders).map((product) => product.sku));
  const catalogProducts = catalogPayload.items || [];
  const unsold = catalogProducts
    .filter((product) => product.status === 1 && product.type_id !== "configurable")
    .filter((product) => !soldSkus.has(product.sku))
    .map((product) => ({ sku: product.sku, name: product.name }));

  return {
    source: "adobe-commerce-rest",
    data: {
      days: safeDays,
      enabledSimpleProductCount: catalogProducts.filter((p) => p.status === 1 && p.type_id !== "configurable").length,
      unsoldCount: unsold.length,
      unsold: unsold.slice(0, safeLimit),
      note: "Excludes configurable (parent) products, which never carry their own sales — only their child SKUs do.",
    },
  };
}

async function salesSummary({ days = 30, fromDate, toDate, status, couponCode }, context = {}) {
  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);

  if (hasAdobeCommerceConfig()) {
    const filters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });

    if (status) {
      filters.push({ field: "status", value: status, condition: "eq" });
    }

    if (couponCode) {
      filters.push({ field: "coupon_code", value: couponCode, condition: "eq" });
    }

    const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);
    const revenue = orders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);
    const currency = orders[0]?.order_currency_code || "USD";
    const promoOrders = orders.filter((order) => order.coupon_code);
    const promoRevenue = promoOrders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);

    return {
      source: "adobe-commerce-rest",
      data: {
        days: safeDays,
        fromDate: fromDate || null,
        toDate: toDate || null,
        orders: orders.length,
        totalMatchingOrders: totalCount,
        capped: totalCount > orders.length,
        revenue: revenue.toFixed(2),
        averageOrderValue: orders.length ? (revenue / orders.length).toFixed(2) : "0.00",
        currency,
        promoOrders: promoOrders.length,
        promoRevenue: promoRevenue.toFixed(2),
        promoOrderPercentage: orders.length ? Number(((promoOrders.length / orders.length) * 100).toFixed(1)) : 0,
      },
    };
  }

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

// Shared aggregation helper: pulls up to pageSize raw orders matching filters. Callers that
// sum/group across the result set (salesSummary, topSellingProducts, topCustomers,
// ordersByRegion, coupon revenue) should treat totalCount vs items.length as a signal that
// results were capped for very high-volume ranges.
async function fetchOrdersByFilters(
  { filters = [], pageSize = 200, sortField = "created_at", sortDirection = "DESC" },
  context = {},
) {
  const params = buildSearchCriteriaParams(filters, { pageSize, sortField, sortDirection });
  const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${params.toString()}`, {
    token: context.token,
  });

  return {
    items: payload.items || [],
    totalCount: Number(payload.total_count || 0),
  };
}

// Builds created_at filters from either an explicit fromDate/toDate range or a rolling
// "last N days" window when no explicit dates are given.
function resolveDateRangeFilters({ days, fromDate, toDate }) {
  const filters = [];

  if (fromDate) {
    filters.push({ field: "created_at", value: `${fromDate} 00:00:00`, condition: "gteq" });
  } else if (days) {
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    filters.push({ field: "created_at", value: `${from} 00:00:00`, condition: "gteq" });
  }

  if (toDate) {
    filters.push({ field: "created_at", value: `${toDate} 23:59:59`, condition: "lteq" });
  }

  return filters;
}

function regionFromOrder(order) {
  return order.store_name ? order.store_name.split("\n")[0].trim() : null;
}

async function topCustomers({ days = 30, fromDate, toDate, limit = 5, metric = "revenue" }, context = {}) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);

  if (!hasAdobeCommerceConfig()) {
    return missing("Top customers requires live Adobe Commerce access, which isn't configured yet.");
  }

  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);
  const filters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });
  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);

  const byCustomer = new Map();

  orders.forEach((order) => {
    const name = `${order.customer_firstname || ""} ${order.customer_lastname || ""}`.trim() || "Guest";
    const key = order.customer_email || name;
    const existing = byCustomer.get(key) || {
      customerName: name,
      email: order.customer_email || null,
      orderCount: 0,
      revenue: 0,
    };
    existing.orderCount += 1;
    existing.revenue += Number(order.grand_total || 0);
    byCustomer.set(key, existing);
  });

  const sorted = [...byCustomer.values()]
    .map((customer) => ({ ...customer, revenue: Number(customer.revenue.toFixed(2)) }))
    .sort((a, b) => (metric === "orderCount" ? b.orderCount - a.orderCount : b.revenue - a.revenue));

  return {
    source: "adobe-commerce-rest",
    data: {
      days: safeDays,
      fromDate: fromDate || null,
      toDate: toDate || null,
      ordersScanned: orders.length,
      totalMatchingOrders: totalCount,
      capped: totalCount > orders.length,
      customers: sorted.slice(0, safeLimit),
    },
  };
}

async function ordersByRegion({ days = 30, fromDate, toDate }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Region breakdown requires live Adobe Commerce access, which isn't configured yet.");
  }

  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);
  const filters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });
  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);

  const byRegion = new Map();

  orders.forEach((order) => {
    const region = regionFromOrder(order) || "Unknown";
    const existing = byRegion.get(region) || { region, orderCount: 0, revenue: 0 };
    existing.orderCount += 1;
    existing.revenue += Number(order.grand_total || 0);
    byRegion.set(region, existing);
  });

  const regions = [...byRegion.values()]
    .map((entry) => ({ ...entry, revenue: Number(entry.revenue.toFixed(2)) }))
    .sort((a, b) => b.orderCount - a.orderCount);

  return {
    source: "adobe-commerce-rest",
    data: {
      days: safeDays,
      fromDate: fromDate || null,
      toDate: toDate || null,
      ordersScanned: orders.length,
      totalMatchingOrders: totalCount,
      capped: totalCount > orders.length,
      regions,
    },
  };
}

async function couponRevenue({ couponCode, days = 90, fromDate, toDate }, context = {}) {
  const code = String(couponCode || "").trim();

  if (!code) {
    return missing("Please provide a coupon code.");
  }

  if (!hasAdobeCommerceConfig()) {
    return missing("Coupon revenue lookup requires live Adobe Commerce access, which isn't configured yet.");
  }

  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);
  const filters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });
  filters.push({ field: "coupon_code", value: code, condition: "eq" });

  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);
  const revenue = orders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);

  const byCustomer = new Map();

  orders.forEach((order) => {
    const name = `${order.customer_firstname || ""} ${order.customer_lastname || ""}`.trim() || "Guest";
    const key = order.customer_email || name;
    const existing = byCustomer.get(key) || { customerName: name, email: order.customer_email || null, orderCount: 0 };
    existing.orderCount += 1;
    byCustomer.set(key, existing);
  });

  const customers = [...byCustomer.values()].sort((a, b) => b.orderCount - a.orderCount);

  return {
    source: "adobe-commerce-rest",
    data: {
      couponCode: code,
      totalMatchingOrders: totalCount,
      ordersScanned: orders.length,
      capped: totalCount > orders.length,
      revenue: revenue.toFixed(2),
      currency: orders[0]?.order_currency_code || "USD",
      uniqueCustomers: customers.length,
      customersWithMultipleOrders: customers.filter((customer) => customer.orderCount > 1),
      customers: customers.slice(0, MAX_LIMIT),
    },
  };
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, "").trim();
}

async function getManufacturerLabelMap(context = {}) {
  try {
    const payload = await fetchAdobeCommerceJson(commerceRestPath("/products/attributes/manufacturer/options"), {
      token: context.token,
    });
    return new Map((payload || []).map((option) => [String(option.value), option.label]));
  } catch (error) {
    return new Map();
  }
}

async function getCategoryNameMap(context = {}) {
  try {
    const tree = await fetchAdobeCommerceJson(commerceRestPath("/categories"), { token: context.token });
    const map = new Map();

    function walk(node) {
      if (!node) return;
      map.set(String(node.id), node.name);
      (node.children_data || []).forEach(walk);
    }

    walk(tree);
    return map;
  } catch (error) {
    return new Map();
  }
}

// Fetches the (small, ~150-product) catalog once and builds a sku -> {manufacturer,
// categories} lookup, for joining against order line items without a per-item REST call.
async function getProductAttributeMap(context = {}) {
  const [productsPayload, manufacturerLabels, categoryNames] = await Promise.all([
    fetchAdobeCommerceJson(`${commerceRestPath("/products")}?searchCriteria[pageSize]=200`, { token: context.token }),
    getManufacturerLabelMap(context),
    getCategoryNameMap(context),
  ]);

  const map = new Map();

  (productsPayload.items || []).forEach((product) => {
    const attrs = Object.fromEntries((product.custom_attributes || []).map((attribute) => [attribute.attribute_code, attribute.value]));
    const categoryIds = Array.isArray(attrs.category_ids) ? attrs.category_ids : [];

    map.set(product.sku, {
      manufacturer: manufacturerLabels.get(String(attrs.manufacturer)) || attrs.manufacturer || "Unknown",
      categories: categoryIds.length ? categoryIds.map((id) => categoryNames.get(String(id)) || `category ${id}`) : ["Uncategorized"],
    });
  });

  return map;
}

async function getWebsiteRegionMap(context = {}) {
  try {
    const websites = await fetchAdobeCommerceJson(commerceRestPath("/store/websites"), { token: context.token });
    return new Map((websites || []).map((site) => [site.id, site.name || site.code]));
  } catch (error) {
    return new Map();
  }
}

async function getStockStatus({ sku }, context = {}) {
  if (!sku) {
    return missing("Please provide a product SKU.");
  }

  if (!hasAdobeCommerceConfig()) {
    return missing("Stock status lookup requires live Adobe Commerce access, which isn't configured yet.");
  }

  try {
    const product = await fetchAdobeCommerceJson(commerceRestPath(`/products/${encodeURIComponent(sku)}`), {
      token: context.token,
    });
    const stockItem = await fetchAdobeCommerceJson(commerceRestPath(`/stockItems/${encodeURIComponent(sku)}`), {
      token: context.token,
    }).catch(() => null);
    const websiteMap = await getWebsiteRegionMap(context);
    const websiteIds = product.extension_attributes?.website_ids || [];
    const regions = websiteIds.map((id) => websiteMap.get(id) || `website ${id}`);

    return {
      source: "adobe-commerce-rest",
      data: {
        sku: product.sku,
        name: product.name,
        status: product.status === 1 ? "enabled" : "disabled",
        typeId: product.type_id,
        enabledInRegions: regions,
        qty: stockItem?.qty ?? null,
        isInStock: stockItem?.is_in_stock ?? null,
        lowStockThreshold: stockItem?.notify_stock_qty ?? null,
        isLowStock:
          stockItem && stockItem.notify_stock_qty != null ? stockItem.qty <= stockItem.notify_stock_qty : null,
        note:
          stockItem === null
            ? "No single stock record for this SKU — it may be a configurable/parent product; check a specific child SKU for stock."
            : null,
      },
    };
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return forbidden("Your Commerce account doesn't have permission to view product/stock data.");
    }
    return missing(`No product found for SKU ${sku}.`);
  }
}

async function rmaSummary({ days, fromDate, toDate, status, region, slaThresholdDays = 7 }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("RMA summary requires live Adobe Commerce access, which isn't configured yet.");
  }

  try {
    const records = await fetchRmaAgingReport({ token: context.token });
    const all = Array.isArray(records) ? records : [];

    const from = fromDate ? new Date(fromDate) : days ? new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;

    let filtered = all;

    if (from) {
      filtered = filtered.filter((record) => record.date_requested && new Date(record.date_requested) >= from);
    }

    if (to) {
      filtered = filtered.filter((record) => record.date_requested && new Date(record.date_requested) <= to);
    }

    if (status) {
      const normalizedStatus = String(status).toLowerCase();
      filtered = filtered.filter((record) => String(record.status || "").toLowerCase() === normalizedStatus);
    }

    if (region) {
      const normalizedRegion = String(region).toLowerCase();
      filtered = filtered.filter((record) => String(record.store_code || "").toLowerCase().includes(normalizedRegion));
    }

    const byStatus = {};
    const byRegion = {};
    const reasonCounts = {};
    const skuCounts = new Map();
    const ordersSeen = new Map();
    const delayedRmas = [];
    const now = Date.now();

    filtered.forEach((record) => {
      byStatus[record.status || "unknown"] = (byStatus[record.status || "unknown"] || 0) + 1;
      byRegion[record.store_code || "unknown"] = (byRegion[record.store_code || "unknown"] || 0) + 1;

      const reasonKey = (record.reason || "unspecified").trim() || "unspecified";
      reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;

      (record.line_items || []).forEach((item) => {
        const existing = skuCounts.get(item.sku) || {
          sku: item.sku,
          name: item.product_name,
          returnCount: 0,
          qtyReturned: 0,
        };
        existing.returnCount += 1;
        existing.qtyReturned += Number(item.qty || 0);
        skuCounts.set(item.sku, existing);
      });

      ordersSeen.set(record.order_increment_id, (ordersSeen.get(record.order_increment_id) || 0) + 1);

      const isResolved = record.credit_memo_exists === "Yes";
      if (!isResolved && record.date_requested) {
        const ageDays = (now - new Date(record.date_requested).getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > slaThresholdDays) {
          delayedRmas.push({
            rmaNumber: record.rma_number,
            orderIncrementId: record.order_increment_id,
            status: record.status,
            region: record.store_code,
            ageDays: Math.round(ageDays),
          });
        }
      }
    });

    return {
      source: "adobe-commerce-rest",
      data: {
        totalMatching: filtered.length,
        totalAllTime: all.length,
        byStatus,
        byRegion,
        reasonCounts,
        topReturnedSkus: [...skuCounts.values()].sort((a, b) => b.returnCount - a.returnCount).slice(0, 10),
        ordersWithMultipleRmas: [...ordersSeen.entries()]
          .filter(([, count]) => count > 1)
          .map(([orderIncrementId, count]) => ({ orderIncrementId, rmaCount: count })),
        slaThresholdDays,
        delayedRmas: delayedRmas.slice(0, 20),
        delayedCount: delayedRmas.length,
        dataNotes: [
          "This custom RMA report has no resolution/completion timestamp, so true request-to-resolution turnaround time can't be computed — delayedRmas approximates delay as unresolved RMAs older than slaThresholdDays.",
          "The 'reason' field is frequently not populated with a real reason on this instance ('-' or a placeholder message) — reasonCounts reflects that as-is rather than inventing categories.",
          "This report has no customer identifier, only order_increment_id — 'customers with multiple RMAs' is approximated here as orders with more than one RMA request (ordersWithMultipleRmas).",
        ],
      },
    };
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return forbidden("Your Commerce account doesn't have permission to view returns/RMA data.");
    }
    return missing(`RMA summary lookup failed: ${error.message}`);
  }
}

async function dailySalesTrend({ days = 30 }, context = {}) {
  const safeDays = clamp(Number(days), 1, MAX_DAYS);

  if (!hasAdobeCommerceConfig()) {
    return missing("Revenue trend requires live Adobe Commerce access, which isn't configured yet.");
  }

  const filters = resolveDateRangeFilters({ days: safeDays });
  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);

  const byDay = new Map();

  orders.forEach((order) => {
    const day = String(order.created_at || "").slice(0, 10);

    if (!day) {
      return;
    }

    const existing = byDay.get(day) || { date: day, orders: 0, revenue: 0 };
    existing.orders += 1;
    existing.revenue += Number(order.grand_total || 0);
    byDay.set(day, existing);
  });

  const trend = [...byDay.values()]
    .map((entry) => ({ ...entry, revenue: Number(entry.revenue.toFixed(2)) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    source: "adobe-commerce-rest",
    data: {
      days: safeDays,
      ordersScanned: orders.length,
      totalMatchingOrders: totalCount,
      capped: totalCount > orders.length,
      trend,
    },
  };
}

async function salesBreakdown({ dimension = "category", days = 30, fromDate, toDate, limit = 10 }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Sales breakdown requires live Adobe Commerce access, which isn't configured yet.");
  }

  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);
  const filters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });
  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);

  const grouped = new Map();

  if (dimension === "paymentMethod") {
    orders.forEach((order) => {
      const key = order.payment?.method || "unknown";
      const existing = grouped.get(key) || { label: key, orderCount: 0, revenue: 0 };
      existing.orderCount += 1;
      existing.revenue += Number(order.grand_total || 0);
      grouped.set(key, existing);
    });
  } else {
    const attributeMap = await getProductAttributeMap(context);

    orders.forEach((order) => {
      (order.items || [])
        .filter((item) => !item.parent_item_id)
        .forEach((item) => {
          const attrs = attributeMap.get(item.sku);
          const labels =
            dimension === "brand"
              ? [attrs?.manufacturer || "Unknown"]
              : attrs?.categories?.length
                ? attrs.categories
                : ["Uncategorized"];

          labels.forEach((label) => {
            const existing = grouped.get(label) || { label, qty: 0, revenue: 0 };
            existing.qty += Number(item.qty_ordered || 0);
            existing.revenue += Number(item.row_total || 0);
            grouped.set(label, existing);
          });
        });
    });
  }

  const breakdown = [...grouped.values()]
    .map((entry) => ({ ...entry, revenue: Number(entry.revenue.toFixed(2)) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, safeLimit);

  return {
    source: "adobe-commerce-rest",
    data: {
      dimension,
      days: safeDays,
      fromDate: fromDate || null,
      toDate: toDate || null,
      ordersScanned: orders.length,
      totalMatchingOrders: totalCount,
      capped: totalCount > orders.length,
      breakdown,
    },
  };
}

async function customerActivitySummary({ days = 1, fromDate, toDate }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Customer activity summary requires live Adobe Commerce access, which isn't configured yet.");
  }

  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);
  const dateFilters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });

  const newCustomersParams = buildSearchCriteriaParams(dateFilters, { pageSize: 200 });
  const newCustomersPayload = await fetchAdobeCommerceJson(
    `${commerceRestPath("/customers/search")}?${newCustomersParams.toString()}`,
    { token: context.token },
  );
  const newCustomers = newCustomersPayload.items || [];
  const newCustomerIds = new Set(newCustomers.map((customer) => customer.id));

  const { items: orders, totalCount: totalMatchingOrders } = await fetchOrdersByFilters(
    { filters: dateFilters },
    context,
  );

  const byCustomer = new Map();
  let guestOrders = 0;

  orders.forEach((order) => {
    if (!order.customer_id) {
      guestOrders += 1;
      return;
    }

    const existing = byCustomer.get(order.customer_id) || {
      customerId: order.customer_id,
      customerName: `${order.customer_firstname || ""} ${order.customer_lastname || ""}`.trim() || "Guest",
      email: order.customer_email || null,
      orderCount: 0,
      revenue: 0,
    };
    existing.orderCount += 1;
    existing.revenue += Number(order.grand_total || 0);
    byCustomer.set(order.customer_id, existing);
  });

  const activeCustomers = [...byCustomer.values()];
  const returningCustomers = activeCustomers.filter((customer) => !newCustomerIds.has(customer.customerId));

  return {
    source: "adobe-commerce-rest",
    data: {
      days: safeDays,
      fromDate: fromDate || null,
      toDate: toDate || null,
      newCustomerAccounts: newCustomers.length,
      customersWhoOrdered: activeCustomers.length,
      returningCustomers: returningCustomers.length,
      guestOrders,
      ordersScanned: orders.length,
      totalMatchingOrders,
      capped: totalMatchingOrders > orders.length,
      topReturningCustomers: returningCustomers
        .map((customer) => ({ ...customer, revenue: Number(customer.revenue.toFixed(2)) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
      note: "'New' = a Commerce account created in this period. 'Returning' = placed an order in this period on an account created before it. Guest checkouts aren't tied to an account, so they're counted separately and excluded from both.",
    },
  };
}

async function catalogQualityReport(_args, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Catalog quality report requires live Adobe Commerce access, which isn't configured yet.");
  }

  const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/products")}?searchCriteria[pageSize]=200`, {
    token: context.token,
  });
  const products = payload.items || [];

  const disabled = [];
  const missingImage = [];
  const missingDescription = [];
  const missingCategory = [];

  products.forEach((product) => {
    const attrs = Object.fromEntries((product.custom_attributes || []).map((attribute) => [attribute.attribute_code, attribute.value]));

    if (product.status !== 1) {
      disabled.push(product.sku);
    }

    if (!attrs.image && !product.media_gallery_entries?.length) {
      missingImage.push(product.sku);
    }

    if (!attrs.description && !attrs.short_description) {
      missingDescription.push(product.sku);
    }

    const categoryIds = Array.isArray(attrs.category_ids) ? attrs.category_ids : [];
    if (categoryIds.length === 0) {
      missingCategory.push(product.sku);
    }
  });

  return {
    source: "adobe-commerce-rest",
    data: {
      totalProducts: products.length,
      totalMatchingProducts: Number(payload.total_count || 0),
      capped: Number(payload.total_count || 0) > products.length,
      disabledCount: disabled.length,
      disabledSample: disabled.slice(0, 20),
      missingImageCount: missingImage.length,
      missingImageSample: missingImage.slice(0, 20),
      missingDescriptionCount: missingDescription.length,
      missingDescriptionSample: missingDescription.slice(0, 20),
      missingCategoryCount: missingCategory.length,
      missingCategorySample: missingCategory.slice(0, 20),
    },
  };
}

async function getIngramOrderStatus({ orderIncrementId }, context = {}) {
  if (!orderIncrementId) {
    return missing("Please provide an order number.");
  }

  if (!hasAdobeCommerceConfig()) {
    return missing("Ingram order status requires live Adobe Commerce access, which isn't configured yet.");
  }

  const criteria = searchCriteria([{ field: "increment_id", value: orderIncrementId }]);
  const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/orders")}?${criteria}`, { token: context.token });
  const order = payload.items?.[0];

  if (!order) {
    return missing(`No order found for ${orderIncrementId}.`);
  }

  const ingramEvents = (order.status_histories || [])
    .filter((history) => /ingram/i.test(history.comment || ""))
    .map((history) => ({ comment: stripHtml(history.comment), createdAt: history.created_at }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  let ingramStatus = "no_ingram_activity_found";

  if (ingramEvents.some((event) => /rejected|canceled/i.test(event.comment))) {
    ingramStatus = "rejected_or_canceled";
  } else if (ingramEvents.some((event) => /successfully created/i.test(event.comment))) {
    ingramStatus = "synced";
  } else if (ingramEvents.length > 0) {
    ingramStatus = "queued_pending";
  }

  return {
    source: "adobe-commerce-rest",
    data: { orderIncrementId, ingramStatus, events: ingramEvents },
  };
}

async function ingramSyncIssues({ days = 7, limit = 20 }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Ingram sync issue scan requires live Adobe Commerce access, which isn't configured yet.");
  }

  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const filters = resolveDateRangeFilters({ days: clamp(Number(days), 1, MAX_DAYS) });
  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);

  const issues = [];
  let syncedCount = 0;
  let noActivityCount = 0;

  orders.forEach((order) => {
    const ingramEvents = (order.status_histories || []).filter((history) => /ingram/i.test(history.comment || ""));

    if (ingramEvents.length === 0) {
      noActivityCount += 1;
      return;
    }

    const rejected = ingramEvents.find((event) => /rejected|canceled/i.test(event.comment || ""));
    const succeeded = ingramEvents.some((event) => /successfully created/i.test(event.comment || ""));

    if (rejected) {
      issues.push({
        orderIncrementId: order.increment_id,
        issue: "rejected_or_canceled",
        comment: stripHtml(rejected.comment),
        createdAt: rejected.created_at,
      });
    } else if (!succeeded) {
      const latest = ingramEvents[ingramEvents.length - 1];
      issues.push({
        orderIncrementId: order.increment_id,
        issue: "queued_no_confirmation_yet",
        comment: stripHtml(latest.comment),
        createdAt: latest.created_at,
      });
    } else {
      syncedCount += 1;
    }
  });

  return {
    source: "adobe-commerce-rest",
    data: {
      days: clamp(Number(days), 1, MAX_DAYS),
      ordersScanned: orders.length,
      totalMatchingOrders: totalCount,
      capped: totalCount > orders.length,
      syncedCount,
      noIngramActivityCount: noActivityCount,
      issueCount: issues.length,
      issues: issues.slice(0, safeLimit),
    },
  };
}

async function customersByLocation({ days = 30, fromDate, toDate, dimension = "country" }, context = {}) {
  if (!hasAdobeCommerceConfig()) {
    return missing("Location breakdown requires live Adobe Commerce access, which isn't configured yet.");
  }

  const usingExplicitDates = Boolean(fromDate || toDate);
  const safeDays = usingExplicitDates ? null : clamp(Number(days), 1, MAX_DAYS);
  const filters = resolveDateRangeFilters({ days: safeDays, fromDate, toDate });
  const { items: orders, totalCount } = await fetchOrdersByFilters({ filters }, context);

  const byLocation = new Map();

  orders.forEach((order) => {
    const address = order.extension_attributes?.shipping_assignments?.[0]?.shipping?.address || order.billing_address;
    const key =
      dimension === "city"
        ? [address?.city, address?.country_id].filter(Boolean).join(", ") || "Unknown"
        : address?.country_id || "Unknown";
    const existing = byLocation.get(key) || { location: key, orderCount: 0, revenue: 0 };
    existing.orderCount += 1;
    existing.revenue += Number(order.grand_total || 0);
    byLocation.set(key, existing);
  });

  const locations = [...byLocation.values()]
    .map((entry) => ({ ...entry, revenue: Number(entry.revenue.toFixed(2)) }))
    .sort((a, b) => b.orderCount - a.orderCount);

  return {
    source: "adobe-commerce-rest",
    data: {
      dimension,
      days: safeDays,
      fromDate: fromDate || null,
      toDate: toDate || null,
      ordersScanned: orders.length,
      totalMatchingOrders: totalCount,
      capped: totalCount > orders.length,
      locations,
    },
  };
}

async function getProductDetails({ sku }, context = {}) {
  if (!sku) {
    return missing("Please provide a product SKU.");
  }

  if (hasAdobeCommerceConfig()) {
    try {
      const product = await fetchAdobeCommerceJson(commerceRestPath(`/products/${encodeURIComponent(sku)}`), {
        token: context.token,
      });
      const attrs = Object.fromEntries((product.custom_attributes || []).map((attribute) => [attribute.attribute_code, attribute.value]));
      const [manufacturerLabels, categoryNames] = await Promise.all([
        getManufacturerLabelMap(context),
        getCategoryNameMap(context),
      ]);
      const categoryIds = Array.isArray(attrs.category_ids) ? attrs.category_ids : [];

      return {
        source: "adobe-commerce-rest",
        data: {
          sku: product.sku,
          name: product.name,
          price: Number(product.price || 0).toFixed(2),
          status: product.status === 1 ? "enabled" : "disabled",
          typeId: product.type_id,
          manufacturer: manufacturerLabels.get(String(attrs.manufacturer)) || attrs.manufacturer || null,
          categories: categoryIds.map((id) => categoryNames.get(String(id)) || `category ${id}`),
          ingramPartNumber: attrs.ingram_part_number || null,
        },
      };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        return forbidden("Your Commerce account doesn't have permission to view product data.");
      }
      return missing(`No product found for SKU ${sku}.`);
    }
  }

  const product = mockProducts.find((item) => item.sku.toLowerCase() === String(sku).toLowerCase());
  return product ? withMock(product) : missing(`No product found for SKU ${sku}.`);
}

async function searchProducts({ keyword, limit = 10 }, context = {}) {
  const safeLimit = clamp(Number(limit), 1, MAX_LIMIT);
  const term = String(keyword || "").trim();

  if (!term) {
    return missing("Please provide a product name or keyword to search for.");
  }

  if (hasAdobeCommerceConfig()) {
    const params = new URLSearchParams(searchCriteria([{ field: "name", value: `%${term}%`, condition: "like" }]));
    params.set("searchCriteria[pageSize]", String(safeLimit));
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/products")}?${params.toString()}`, {
      token: context.token,
    });

    return {
      source: "adobe-commerce-rest",
      data: {
        keyword: term,
        products: (payload.items || []).map((product) => ({
          sku: product.sku,
          name: product.name,
          price: Number(product.price || 0).toFixed(2),
          status: product.status === 1 ? "enabled" : "disabled",
        })),
      },
    };
  }

  const normalized = term.toLowerCase();
  const products = mockProducts.filter((product) => product.name.toLowerCase().includes(normalized));

  return {
    source: "mock",
    data: { keyword: term, products: products.slice(0, safeLimit) },
  };
}

async function getCustomerDetails({ customerName, email }, context = {}) {
  const term = String(email || customerName || "").trim();

  if (!term) {
    return missing("Please provide a customer name or email.");
  }

  if (hasAdobeCommerceConfig()) {
    const field = email ? "email" : "lastname";
    const criteria = searchCriteria([{ field, value: term }]);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/customers/search")}?${criteria}`, {
      token: context.token,
    });
    const customer = payload.items?.[0];

    if (!customer) {
      return missing(`No customer found for ${term}.`);
    }

    return {
      source: "adobe-commerce-rest",
      data: {
        email: customer.email,
        firstName: customer.firstname,
        lastName: customer.lastname,
        groupId: customer.group_id,
        createdAt: customer.created_at,
      },
    };
  }

  const normalized = term.toLowerCase();
  const customer = mockCustomers.find(
    (item) => item.email.toLowerCase() === normalized || matchesCustomerName(`${item.firstName} ${item.lastName}`, term),
  );

  return customer ? withMock(customer) : missing(`No customer found for ${term}.`);
}

async function listInvoicesForOrder({ orderIncrementId }, context = {}) {
  if (!orderIncrementId) {
    return missing("Please provide an order number to look up invoices.");
  }

  if (hasAdobeCommerceConfig()) {
    const orderResult = await getOrderStatus({ orderIncrementId }, context);
    const entityId = orderResult.data?.entityId;

    if (!entityId) {
      return { source: orderResult.source, data: { orderIncrementId, invoices: [] } };
    }

    const criteria = searchCriteria([{ field: "order_id", value: entityId }]);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/invoices")}?${criteria}`, {
      token: context.token,
    });

    return {
      source: "adobe-commerce-rest",
      data: {
        orderIncrementId,
        invoices: (payload.items || []).map((invoice) => ({
          invoiceId: String(invoice.entity_id),
          grandTotal: Number(invoice.grand_total || 0).toFixed(2),
          state: invoice.state,
          createdAt: invoice.created_at,
        })),
      },
    };
  }

  return {
    source: "mock",
    data: {
      orderIncrementId,
      invoices: mockInvoices.filter((item) => item.orderIncrementId === orderIncrementId),
    },
  };
}

async function getCreditMemoStatus({ orderIncrementId }, context = {}) {
  if (!orderIncrementId) {
    return missing("Please provide an order number to look up credit memos.");
  }

  if (hasAdobeCommerceConfig()) {
    const orderResult = await getOrderStatus({ orderIncrementId }, context);
    const entityId = orderResult.data?.entityId;

    if (!entityId) {
      return { source: orderResult.source, data: { orderIncrementId, creditMemos: [] } };
    }

    const criteria = searchCriteria([{ field: "order_id", value: entityId }]);
    const payload = await fetchAdobeCommerceJson(`${commerceRestPath("/creditmemos")}?${criteria}`, {
      token: context.token,
    });

    return {
      source: "adobe-commerce-rest",
      data: {
        orderIncrementId,
        creditMemos: (payload.items || []).map((creditMemo) => ({
          creditMemoId: String(creditMemo.entity_id),
          grandTotal: Number(creditMemo.grand_total || 0).toFixed(2),
          state: creditMemo.state,
          createdAt: creditMemo.created_at,
        })),
      },
    };
  }

  return {
    source: "mock",
    data: {
      orderIncrementId,
      creditMemos: mockCreditMemos.filter((item) => item.orderIncrementId === orderIncrementId),
    },
  };
}

async function getStoreConfig(_args, context = {}) {
  if (hasAdobeCommerceConfig()) {
    const payload = await fetchAdobeCommerceJson(commerceRestPath("/store/storeConfigs"), { token: context.token });
    const config = payload?.[0] || {};

    return {
      source: "adobe-commerce-rest",
      data: {
        baseUrl: config.base_url,
        baseCurrencyCode: config.base_currency_code,
        defaultDisplayCurrencyCode: config.default_display_currency_code,
        timezone: config.timezone,
        locale: config.locale,
      },
    };
  }

  return withMock(mockStoreConfig);
}

async function getIngramConfiguration(_args, context = {}) {
  if (hasAdobeCommerceConfig()) {
    try {
      const config = await fetchIngramConfiguration({ token: context.token });
      return { source: "adobe-commerce-rest", data: config };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        return forbidden("Your Commerce account doesn't have permission to view Ingram configuration.");
      }
      return {
        source: "adobe-commerce-rest",
        data: {
          error:
            "Ingram configuration isn't connected yet. The Commerce endpoint for Ingram configuration has not been deployed.",
        },
      };
    }
  }

  return withMock(mockIngramConfiguration);
}

// Prefixes of Adobe Commerce V1 REST paths that queryCommerceApi is allowed to GET.
// Deny-by-default: anything not starting with one of these is rejected before any
// network call is made, so this stays a read-only extension of the named tools above,
// not an open door to the whole Commerce admin API (no integrations/users/ACL/webapi).
const ALLOWED_QUERY_ENDPOINT_PREFIXES = [
  "/orders",
  "/invoices",
  "/shipments",
  "/shipment",
  "/creditmemos",
  "/products",
  "/categories",
  "/customers",
  "/customerGroups",
  "/salesRules",
  "/coupons",
  "/store",
  "/directory",
  "/countries",
  "/rma-aging-report",
  "/seagate/chatbot",
];

async function queryCommerceApi({ endpoint, filters = [], pageSize, sortField, sortDirection }, context = {}) {
  const path = String(endpoint || "").trim();

  if (!path.startsWith("/")) {
    return missing("Please provide a Commerce REST endpoint path starting with /, for example /salesRules/search.");
  }

  if (path.includes("..") || path.includes("://")) {
    return missing("Invalid endpoint path.");
  }

  const isAllowed = ALLOWED_QUERY_ENDPOINT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
  );

  if (!isAllowed) {
    return missing(
      `Endpoint ${path} is outside the allowed read-only areas (${ALLOWED_QUERY_ENDPOINT_PREFIXES.join(", ")}). Ask a developer to add support for it instead of guessing.`,
    );
  }

  if (!hasAdobeCommerceConfig()) {
    return missing("This lookup needs live Adobe Commerce access, which isn't configured yet. Ask an admin to set ADOBE_COMMERCE_BASE_URL.");
  }

  const safePageSize = pageSize ? clamp(Number(pageSize), 1, MAX_LIMIT) : undefined;
  const params = buildSearchCriteriaParams(Array.isArray(filters) ? filters : [], {
    pageSize: safePageSize,
    sortField,
    sortDirection,
  });
  const query = params.toString();

  try {
    const data = await fetchAdobeCommerceJson(`${commerceRestPath(path)}${query ? `?${query}` : ""}`, {
      token: context.token,
    });
    return { source: "adobe-commerce-rest", data };
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      return forbidden(`Your Commerce account doesn't have permission to access ${path}.`);
    }
    return missing(`Lookup failed: ${error.message}`);
  }
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
        ? `${error} The chatbot is currently using mock data, not staging. Configure ADOBE_COMMERCE_BASE_URL in server/.env to search staging orders.`
        : error,
    },
  };
}

// Distinct from missing(): this is a real 401/403 from Commerce, not "no data found" — the
// caller has a valid session but their own Commerce account lacks permission for this call.
function forbidden(error) {
  return {
    source: "adobe-commerce-rest",
    data: { error, permissionDenied: true },
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
    couponCode: order.coupon_code || null,
    region: regionFromOrder(order),
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

// Mirrors the live REST matchType "exact_first_or_last_name": a query matches a
// customer/order name if it equals the full name, or equals just the first or last token.
function matchesCustomerName(candidateFullName, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedCandidate = String(candidateFullName || "").trim().toLowerCase();

  if (!normalizedQuery || !normalizedCandidate) {
    return false;
  }

  if (normalizedCandidate === normalizedQuery) {
    return true;
  }

  return normalizedCandidate.split(/\s+/).some((part) => part === normalizedQuery);
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.max(min, Math.min(value, max));
}
