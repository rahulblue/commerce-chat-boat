import { applyEnvInputs } from "../lib/env.js";
import { buildCorsHeaders, getRequestOrigin } from "../lib/cors.js";
import { resolveSession } from "../lib/requestSession.js";
import { appendMessage, getRecentMessages } from "../lib/chatHistoryStore.js";
import { answerQuestion } from "../../server/src/chat/orchestrator.js";
import { hasAdobeCommerceConfig } from "../../server/src/commerce/adobeCommerceClient.js";

export async function main(params) {
  // App Builder passes action inputs as top-level params — inject into process.env so the
  // shared server/src modules read them via process.env.* exactly as the Express server does.
  applyEnvInputs(params);
  const corsHeaders = buildCorsHeaders(getRequestOrigin(params));

  if (params.__ow_method === "options") {
    return { statusCode: 200, headers: corsHeaders, body: "{}" };
  }

  // Web actions with Content-Type: application/json have the body auto-parsed into params.
  // Fall back to __ow_body (base64) for raw-http mode.
  let question = "";
  let clientHistory = [];

  if (params.question !== undefined) {
    question = String(params.question || "").trim();
    clientHistory = Array.isArray(params.history) ? params.history : [];
  } else if (params.__ow_body) {
    const raw = Buffer.from(params.__ow_body, "base64").toString("utf-8");
    const body = JSON.parse(raw);
    question = String(body.question || "").trim();
    clientHistory = Array.isArray(body.history) ? body.history : [];
  }

  if (!question) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Question is required." }),
    };
  }

  let session = null;
  let setCookieHeader;

  if (hasAdobeCommerceConfig()) {
    const resolved = await resolveSession(params);
    session = resolved.session;
    setCookieHeader = resolved.setCookieHeader;

    if (!session) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "not_authenticated" }) };
    }
  }

  try {
    const history = session ? await getRecentMessages(session.commerceUsername) : clientHistory;

    if (session) {
      await appendMessage({ commerceUsername: session.commerceUsername, role: "user", content: question });
    }

    const result = await answerQuestion({ question, history, session });

    if (session) {
      await appendMessage({
        commerceUsername: session.commerceUsername,
        role: "assistant",
        content: result.answer,
        toolCalls: result.toolCalls,
      });
    }

    return {
      statusCode: 200,
      headers: setCookieHeader ? { ...corsHeaders, "Set-Cookie": setCookieHeader } : corsHeaders,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Chat action error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Unable to answer the question right now." }),
    };
  }
}
