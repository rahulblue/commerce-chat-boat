import { answerQuestion } from "../../server/src/chat/orchestrator.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export async function main(params) {
  // App Builder passes action inputs as top-level params — inject into process.env
  // so the existing orchestrator/commerce modules read them via process.env.*
  if (params.ANTHROPIC_API_KEY)        process.env.ANTHROPIC_API_KEY        = params.ANTHROPIC_API_KEY;
  if (params.ANTHROPIC_MODEL)          process.env.ANTHROPIC_MODEL          = params.ANTHROPIC_MODEL;
  if (params.ADOBE_COMMERCE_BASE_URL)  process.env.ADOBE_COMMERCE_BASE_URL  = params.ADOBE_COMMERCE_BASE_URL;
  if (params.ADOBE_COMMERCE_REST_PREFIX) process.env.ADOBE_COMMERCE_REST_PREFIX = params.ADOBE_COMMERCE_REST_PREFIX;
  if (params.ADOBE_COMMERCE_ADMIN_TOKEN) process.env.ADOBE_COMMERCE_ADMIN_TOKEN = params.ADOBE_COMMERCE_ADMIN_TOKEN;

  // Handle CORS preflight
  if (params.__ow_method === "options") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "{}" };
  }

  // Web actions with Content-Type: application/json have the body auto-parsed into params.
  // Fall back to __ow_body (base64) for raw-http mode.
  let question = "";
  let history = [];

  if (params.question !== undefined) {
    question = String(params.question || "").trim();
    history = Array.isArray(params.history) ? params.history : [];
  } else if (params.__ow_body) {
    const raw = Buffer.from(params.__ow_body, "base64").toString("utf-8");
    const body = JSON.parse(raw);
    question = String(body.question || "").trim();
    history = Array.isArray(body.history) ? body.history : [];
  }

  if (!question) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Question is required." }),
    };
  }

  try {
    const result = await answerQuestion({ question, history });
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Chat action error:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Unable to answer the question right now." }),
    };
  }
}
