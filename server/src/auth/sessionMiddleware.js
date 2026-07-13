import { deleteSession, getSession, touchSession } from "./sessionStore.js";

export const COOKIE_NAME = "cc_session";

export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeMs,
  };
}

// Attaches req.session = {id, commerceUsername, commerceToken} on a valid, non-expired
// session cookie, sliding its expiration forward on every request. 401s otherwise.
export function requireSession(req, res, next) {
  const sessionId = req.signedCookies?.[COOKIE_NAME];

  if (!sessionId) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }

  const session = getSession(sessionId);

  if (!session) {
    res.clearCookie(COOKIE_NAME);
    res.status(401).json({ error: "not_authenticated" });
    return;
  }

  const newExpiresAt = touchSession(sessionId);
  res.cookie(COOKIE_NAME, sessionId, cookieOptions(newExpiresAt - Date.now()));

  req.session = session;
  next();
}

export function clearSessionCookie(req, res) {
  const sessionId = req.signedCookies?.[COOKIE_NAME];

  if (sessionId) {
    deleteSession(sessionId);
  }

  res.clearCookie(COOKIE_NAME);
}
