import express from "express";
import { CommerceApiError, exchangeAdminCredentials } from "../commerce/adobeCommerceClient.js";
import { clearSessionCookie, cookieOptions, COOKIE_NAME, requireSession } from "../auth/sessionMiddleware.js";
import { createSession } from "../auth/sessionStore.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  try {
    const token = await exchangeAdminCredentials(username, password);
    const { id, expiresAt } = createSession({ commerceUsername: username, commerceToken: token });

    res.cookie(COOKIE_NAME, id, cookieOptions(expiresAt - Date.now()));
    res.json({ username });
  } catch (error) {
    if (error instanceof CommerceApiError && error.status === 401) {
      res.status(401).json({ error: "Invalid Commerce admin username or password." });
      return;
    }

    console.error("Login failed:", error);
    res.status(502).json({ error: "Commerce is unreachable right now. Please try again shortly." });
  }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get("/me", requireSession, (req, res) => {
  res.json({ username: req.session.commerceUsername });
});

export default router;
