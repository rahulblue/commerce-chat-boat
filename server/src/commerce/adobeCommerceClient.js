export function hasAdobeCommerceConfig() {
  return Boolean(process.env.ADOBE_COMMERCE_BASE_URL && process.env.ADOBE_COMMERCE_ADMIN_TOKEN);
}

export async function fetchAdobeCommerceJson(path) {
  const baseUrl = process.env.ADOBE_COMMERCE_BASE_URL?.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.ADOBE_COMMERCE_ADMIN_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Adobe Commerce API failed with ${response.status}: ${details.slice(0, 500)}`);
  }

  return response.json();
}

export function commerceRestPath(v1Path) {
  const restPrefix = process.env.ADOBE_COMMERCE_REST_PREFIX || "/rest/default";
  return `${restPrefix}/V1${v1Path}`;
}

export function searchCriteria(filters) {
  const params = new URLSearchParams();

  filters.forEach((filter, index) => {
    params.set(`searchCriteria[filter_groups][${index}][filters][0][field]`, filter.field);
    params.set(`searchCriteria[filter_groups][${index}][filters][0][value]`, filter.value);
    params.set(`searchCriteria[filter_groups][${index}][filters][0][condition_type]`, filter.condition || "eq");
  });

  return params.toString();
}
