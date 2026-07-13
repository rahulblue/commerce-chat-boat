import { applyEnvInputs } from "../lib/env.js";
import { buildCorsHeaders, getRequestOrigin } from "../lib/cors.js";
import { resolveSession } from "../lib/requestSession.js";
import { getAllMessages } from "../lib/chatHistoryStore.js";
import { hasAdobeCommerceConfig } from "../../server/src/commerce/adobeCommerceClient.js";

export async function main(params) {
  applyEnvInputs(params);
  const corsHeaders = buildCorsHeaders(getRequestOrigin(params));

  if (params.__ow_method === "options") {
    return { statusCode: 200, headers: corsHeaders, body: "{}" };
  }

  if (!hasAdobeCommerceConfig()) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ messages: [] }) };
  }

  const { session, setCookieHeader } = await resolveSession(params);

  if (!session) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "not_authenticated" }) };
  }

  const messages = await getAllMessages(session.commerceUsername);

  return {
    statusCode: 200,
    headers: setCookieHeader ? { ...corsHeaders, "Set-Cookie": setCookieHeader } : corsHeaders,
    body: JSON.stringify({ messages }),
  };
}
