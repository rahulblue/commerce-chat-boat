import crypto from "node:crypto";

export function parseCookies(cookieHeader = "") {
  const out = {};

  String(cookieHeader)
    .split(";")
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return;
      const key = pair.slice(0, idx).trim();
      if (key) out[key] = decodeURIComponent(pair.slice(idx + 1).trim());
    });

  return out;
}

// A simple, self-consistent signing scheme — not wire-compatible with cookie-parser's
// cookie-signature format used in server/. That's fine: actions and the local dev server
// are on different domains and never need to validate each other's cookies.
export function signValue(value, secret) {
  const mac = crypto.createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function unsignValue(signed, secret) {
  if (typeof signed !== "string") {
    return null;
  }

  const idx = signed.lastIndexOf(".");
  if (idx === -1) {
    return null;
  }

  const value = signed.slice(0, idx);
  const macBuffer = Buffer.from(signed.slice(idx + 1));
  const expectedBuffer = Buffer.from(crypto.createHmac("sha256", secret).update(value).digest("base64url"));

  if (macBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(macBuffer, expectedBuffer)) {
    return null;
  }

  return value;
}

// Cross-origin deployment (client and actions are on different domains) requires
// SameSite=None; Secure — different from server/'s same-site-different-port dev case.
export function buildSetCookie(name, value, { maxAgeSeconds = 0, clear = false } = {}) {
  return [
    `${name}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${clear ? 0 : Math.max(1, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}
