const ORDER_ID_PATTERN = /\b(?:order\s*)?([0-9]{6,12})\b/i;
const RMA_ID_PATTERN = /\b(?:rma|return)[\s#-]*([a-z0-9]{3,20})\b/gi;
const SKU_PATTERN = /\b([A-Z]{2,8}[0-9]{3,10})\b/;

export function routeIntent(question) {
  const normalized = question.toLowerCase();
  const orderId = question.match(ORDER_ID_PATTERN)?.[1];
  const rmaId = readRmaId(question);
  const customerName = readCustomerName(question);

  if (/\b(top|best)\b.*\b(selling|seller|products|skus)\b/.test(normalized)) {
    return {
      toolName: "topSellingProducts",
      args: {
        days: readDays(normalized, 30),
        limit: readLimit(normalized, 5),
      },
    };
  }

  if (/\b(sales|revenue|gmv|total)\b.*\b(summary|last|today|week|month|days?)\b/.test(normalized)) {
    return {
      toolName: "salesSummary",
      args: {
        days: readDays(normalized, 30),
      },
    };
  }

  if (/\bingram\b/.test(normalized)) {
    return {
      toolName: "getIngramConfiguration",
      args: {},
    };
  }

  if (
    /\b(store|site)\s*(config|configuration|settings)\b/.test(normalized) ||
    /\b(base currency|display currency|store timezone|store locale|base url)\b/.test(normalized)
  ) {
    return {
      toolName: "getStoreConfig",
      args: {},
    };
  }

  if (/\bcredit\s*memo(s)?\b/.test(normalized)) {
    return {
      toolName: "getCreditMemoStatus",
      args: {
        orderIncrementId: orderId,
      },
    };
  }

  if (/\binvoice(s)?\b/.test(normalized)) {
    return {
      toolName: "listInvoicesForOrder",
      args: {
        orderIncrementId: orderId,
      },
    };
  }

  if (/\b(total|count|number|how many)\b.*\border(s)?\b.*\b(of|for|by|made by|placed by)\b/.test(normalized) && customerName) {
    return {
      toolName: "countOrdersByCustomer",
      args: {
        customerName,
      },
    };
  }

  if (/\b(product|products|sku|skus|item|items|bought|buoght|buy|purchased|purchase|ordered)\b/.test(normalized) && customerName) {
    return {
      toolName: "listPurchasedProductsByCustomer",
      args: {
        customerName,
        toDate: readToDate(question),
        limit: readLimit(normalized, 20),
      },
    };
  }

  if (/\b(all|list|show)\b.*\border(s)?\b.*\b(of|for|by|made by|placed by)\b/.test(normalized) && customerName) {
    return {
      toolName: "listOrdersByCustomer",
      args: {
        customerName,
        limit: readLimit(normalized, 10),
      },
    };
  }

  if (/\b(all|list|show|recent|latest)\b.*\border(s)?\b/.test(normalized) || /\border(s)?\b.*\b(all|list|show|recent|latest)\b/.test(normalized)) {
    return {
      toolName: "listOrders",
      args: {
        limit: readLimit(normalized, 10),
      },
    };
  }

  if (/\bcustomer\b/.test(normalized) && /\b(email|profile|details|info|account)\b/.test(normalized) && customerName) {
    return {
      toolName: "getCustomerDetails",
      args: {
        customerName,
      },
    };
  }

  const sku = question.match(SKU_PATTERN)?.[1];

  if (sku && /\bproduct\b/.test(normalized)) {
    return {
      toolName: "getProductDetails",
      args: {
        sku,
      },
    };
  }

  if (/\b(search|find|look ?up)\b.*\bproduct(s)?\b/.test(normalized) && !customerName) {
    return {
      toolName: "searchProducts",
      args: {
        keyword: readProductKeyword(question),
      },
    };
  }

  if (/\b(return|returns|rma|refund)\b/.test(normalized)) {
    return {
      toolName: "getReturnStatus",
      args: {
        rmaId,
        orderIncrementId: orderId,
      },
    };
  }

  if (/\b(ship|shipment|tracking|delivery|carrier)\b/.test(normalized)) {
    return {
      toolName: "getShipmentStatus",
      args: {
        orderIncrementId: orderId,
      },
    };
  }

  if (orderId || /\border\b/.test(normalized)) {
    return {
      toolName: "getOrderStatus",
      args: {
        orderIncrementId: orderId,
      },
    };
  }

  return {
    toolName: "help",
    args: {},
  };
}

function readDays(normalized, fallback) {
  if (/\btoday\b/.test(normalized)) {
    return 1;
  }

  if (/\byesterday\b/.test(normalized)) {
    return 1;
  }

  if (/\bweek\b/.test(normalized)) {
    return 7;
  }

  if (/\bmonth\b/.test(normalized)) {
    return 30;
  }

  const match = normalized.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/);
  return match ? Math.min(Number(match[1]), 90) : fallback;
}

function readLimit(normalized, fallback) {
  const match = normalized.match(/\btop\s+(\d{1,2})\b/);
  return match ? Math.min(Number(match[1]), 20) : fallback;
}

function readRmaId(question) {
  const match = [...question.matchAll(RMA_ID_PATTERN)].find(([, token]) => /\d/.test(token));
  return match ? `RMA-${match[1]}` : null;
}

function readProductKeyword(question) {
  const match = question.match(/\b(?:search|find|look ?up)\b.*?\bproduct(?:s)?\b\s*(?:for|named|called)?\s*(.+)$/i);
  return match?.[1]?.trim().replace(/[?.!]+$/, "") || null;
}

function readCustomerName(question) {
  const patterns = [
    /\border(?:s)?(?:\s+made|\s+placed)?\s+(?:of|for|by)\s+([a-z][a-z\s.'-]{1,60})(?:\s+by\s+\d|\s+on\s+\d|\s+before\s+\d|\s+after\s+\d)?\??$/i,
    // "how many products does rahul buy/purchase/order"
    /\bhow\s+many\s+(?:product|products|item|items|order|orders)\s+(?:does|did|has|have)\s+([a-z][a-z.'-]{1,40})\s+(?:buy|bought|purchase|purchased|order|ordered)/i,
    // "how many orders did rahul place/make"
    /\bhow\s+many\s+orders?\s+(?:does|did|has|have)\s+([a-z][a-z.'-]{1,40})\b/i,
    // "products/items X bought/purchased"
    /\b(?:product|products|sku|skus|item|items)\s+(?:does|did|has|have)\s+([a-z][a-z.'-]{1,40})\s+(?:buy|bought|purchase|purchased|order|ordered)/i,
    /\b(?:product|products|sku|skus|item|items)\s+([a-z][a-z.'-]{1,40})\s+(?:had\s+)?(?:bought|buoght|buy|purchased|ordered)/i,
    /\b(?:product|products|sku|skus|item|items)\s+(?:did\s+)?([a-z][a-z.'-]{1,40})\s+(?:buy|bought|buoght|purchase|purchased|order|ordered)/i,
    /\bwhat\s+(?:did\s+)?([a-z][a-z.'-]{1,40})\s+(?:buy|bought|buoght|purchase|purchased|order|ordered)/i,
    // "X purchased/bought/ordered" at end of question
    /\b(?:purchased|bought|ordered)\s+by\s+([a-z][a-z.'-]{1,40})\b/i,
  ];

  const match = patterns.map((pattern) => question.match(pattern)).find(Boolean);

  if (!match?.[1]) {
    return null;
  }

  return match[1].trim();
}

function readToDate(question) {
  const match = question.match(/\b(?:by|before|until|till|on)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?/i);

  if (!match) {
    return null;
  }

  const month = monthNumber(match[2]);

  if (!month) {
    return null;
  }

  const year = match[3] || String(new Date().getFullYear());
  const day = match[1].padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function monthNumber(value) {
  const month = value.toLowerCase().slice(0, 3);
  const months = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  return months[month] || null;
}
