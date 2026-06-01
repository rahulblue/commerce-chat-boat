import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { answerQuestion } from "./chat/orchestrator.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!question) {
      res.status(400).json({ error: "Question is required." });
      return;
    }

    const result = await answerQuestion({ question, history });
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
});
