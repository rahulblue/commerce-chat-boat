import { buildSetCookie, parseCookies, signValue, unsignValue } from "./cookies.js";
import { deleteSession, getSession, touchSession } from "./sessionStore.js";

export const COOKIE_NAME = "cc_session";

// Per-action equivalent of server/src/auth/sessionMiddleware.js's requireSession — actions
// have no middleware chaining, so every action that needs auth calls this directly.
export async function resolveSession(params) {
  const raw = parseCookies(params.__ow_headers?.cookie || "")[COOKIE_NAME];

  if (!raw) {
    return { session: null };
  }

  const sessionId = unsignValue(raw, process.env.SESSION_SECRET);

  if (!sessionId) {
    return { session: null };
  }

  const session = await getSession(sessionId);

  if (!session) {
    return { session: null };
  }

  const newExpiresAt = await touchSession(sessionId);
  const setCookieHeader = buildSetCookie(COOKIE_NAME, signValue(sessionId, process.env.SESSION_SECRET), {
    maxAgeSeconds: (newExpiresAt - Date.now()) / 1000,
  });

  return { session, setCookieHeader };
}

export async function clearSessionFromRequest(params) {
  const raw = parseCookies(params.__ow_headers?.cookie || "")[COOKIE_NAME];

  if (raw) {
    const sessionId = unsignValue(raw, process.env.SESSION_SECRET);
    if (sessionId) {
      await deleteSession(sessionId);
    }
  }

  return buildSetCookie(COOKIE_NAME, "", { clear: true });
}
