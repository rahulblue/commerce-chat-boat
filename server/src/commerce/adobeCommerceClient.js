export class CommerceApiError extends Error {
  constructor(status, details) {
    super(`Adobe Commerce API failed with ${status}: ${details}`);
    this.name = "CommerceApiError";
    this.status = status;
  }
}

export function hasAdobeCommerceConfig() {
  return Boolean(process.env.ADOBE_COMMERCE_BASE_URL);
}

let warnedAboutSharedTokenFallback = false;

export async function fetchAdobeCommerceJson(path, { token, signal } = {}) {
  const bearer = token || process.env.ADOBE_COMMERCE_ADMIN_TOKEN;

  if (!token && hasAdobeCommerceConfig() && !warnedAboutSharedTokenFallback) {
    warnedAboutSharedTokenFallback = true;
    console.warn(
      "fetchAdobeCommerceJson called without a per-request token while Commerce is configured — falling back to the shared ADOBE_COMMERCE_ADMIN_TOKEN. This should only happen for unauthenticated/dev paths.",
    );
  }

  const baseUrl = process.env.ADOBE_COMMERCE_BASE_URL?.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new CommerceApiError(response.status, details.slice(0, 500));
  }

  return response.json();
}

// Exchanges a real Commerce admin username/password for a bearer token scoped to that
// admin's own account and permissions. This is the login check itself: success here means
// the caller has a valid Commerce admin account. Never called with any stored credential —
// the password is only ever forwarded here, once, and discarded by the caller afterward.
export async function exchangeAdminCredentials(username, password) {
  const baseUrl = process.env.ADOBE_COMMERCE_BASE_URL?.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${commerceRestPath("/integration/admin/token")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new CommerceApiError(response.status, "Invalid Commerce admin username or password.");
  }

  const token = await response.json();

  if (typeof token !== "string" || !token) {
    throw new CommerceApiError(502, "Commerce did not return a usable admin token.");
  }

  return token;
}

export function commerceRestPath(v1Path) {
  const restPrefix = process.env.ADOBE_COMMERCE_REST_PREFIX || "/rest/default";
  return `${restPrefix}/V1${v1Path}`;
}

export function searchCriteria(filters) {
  return buildSearchCriteriaParams(filters).toString();
}

// General-purpose Adobe Commerce searchCriteria builder: each filter becomes its own
// AND'd filter_group (Commerce ORs filters within a group, ANDs across groups).
export function buildSearchCriteriaParams(filters = [], { pageSize, currentPage, sortField, sortDirection } = {}) {
  const params = new URLSearchParams();

  filters.forEach((filter, index) => {
    params.set(`searchCriteria[filter_groups][${index}][filters][0][field]`, filter.field);
    params.set(`searchCriteria[filter_groups][${index}][filters][0][value]`, filter.value);
    params.set(`searchCriteria[filter_groups][${index}][filters][0][condition_type]`, filter.condition || "eq");
  });

  if (pageSize) {
    params.set("searchCriteria[pageSize]", String(pageSize));
  }

  if (currentPage) {
    params.set("searchCriteria[currentPage]", String(currentPage));
  }

  if (sortField) {
    params.set("searchCriteria[sortOrders][0][field]", sortField);
    params.set("searchCriteria[sortOrders][0][direction]", sortDirection === "ASC" ? "ASC" : "DESC");
  }

  return params;
}

export async function fetchRmaAgingReport(options) {
  return fetchAdobeCommerceJson(commerceRestPath("/rma-aging-report"), options);
}

export async function fetchIngramConfiguration(options) {
  return fetchAdobeCommerceJson(commerceRestPath("/seagate/chatbot/ingram-configuration"), options);
}
