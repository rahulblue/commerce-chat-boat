// Adobe I/O Runtime normalizes request header names; __ow_headers.origin is the expected key.
export function getRequestOrigin(params) {
  return params.__ow_headers?.origin || "";
}

// Never echoes "*" — credentialed (cookie-bearing) requests reject a wildcard origin, so the
// exact request origin must be echoed back, and only when it's in the configured allowlist.
export function buildCorsHeaders(requestOrigin, { methods = "GET, POST, OPTIONS" } = {}) {
  const allowList = (process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const originToEcho = allowList.includes(requestOrigin) ? requestOrigin : allowList[0] || "";

  return {
    "Access-Control-Allow-Origin": originToEcho,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": methods,
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}
