import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { answerQuestion } from "./chat/orchestrator.js";
import { appendMessage, getAllMessages, getRecentMessages } from "./chat/chatHistoryStore.js";
import { hasAdobeCommerceConfig } from "./commerce/adobeCommerceClient.js";
import { requireSession } from "./auth/sessionMiddleware.js";
import authRouter from "./routes/auth.js";

dotenv.config();

if (hasAdobeCommerceConfig()) {
  const required = ["SESSION_SECRET", "COMMERCE_TOKEN_ENC_KEY"];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(
      `Adobe Commerce is configured (login is required), but these env vars are missing: ${missing.join(", ")}. ` +
        "Generate SESSION_SECRET with any long random string, and COMMERCE_TOKEN_ENC_KEY with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    process.exit(1);
  }
}

const app = express();
const port = Number(process.env.PORT || 4000);
const authRequired = hasAdobeCommerceConfig();

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, authRequired });
});

if (authRequired) {
  app.use("/api/auth", authRouter);
}

app.get("/api/chat/history", authRequired ? requireSession : (_req, res) => res.json({ messages: [] }), (req, res) => {
  res.json({ messages: getAllMessages(req.session.commerceUsername) });
});

app.post("/api/chat", authRequired ? requireSession : (_req, _res, next) => next(), async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();

    if (!question) {
      res.status(400).json({ error: "Question is required." });
      return;
    }

    const commerceUsername = req.session?.commerceUsername;
    const history = commerceUsername
      ? getRecentMessages(commerceUsername)
      : Array.isArray(req.body?.history)
        ? req.body.history
        : [];

    if (commerceUsername) {
      appendMessage({ commerceUsername, role: "user", content: question });
    }

    const result = await answerQuestion({ question, history, session: req.session });

    if (commerceUsername) {
      appendMessage({
        commerceUsername,
        role: "assistant",
        content: result.answer,
        toolCalls: result.toolCalls,
      });
    }

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to answer the question right now.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Commerce admin chatbot API listening on http://localhost:${port}`);
  console.log(authRequired ? "Login required (Adobe Commerce configured)." : "Running in mock-data mode, no login required.");
});
