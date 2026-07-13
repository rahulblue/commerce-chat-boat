import { applyEnvInputs } from "../lib/env.js";
import { buildCorsHeaders, getRequestOrigin } from "../lib/cors.js";
import { clearSessionFromRequest } from "../lib/requestSession.js";

export async function main(params) {
  applyEnvInputs(params);
  const corsHeaders = buildCorsHeaders(getRequestOrigin(params));

  if (params.__ow_method === "options") {
    return { statusCode: 200, headers: corsHeaders, body: "{}" };
  }

  const setCookie = await clearSessionFromRequest(params);

  return {
    statusCode: 200,
    headers: { ...corsHeaders, "Set-Cookie": setCookie },
    body: JSON.stringify({ ok: true }),
  };
}
