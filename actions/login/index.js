import { applyEnvInputs } from "../lib/env.js";
import { buildCorsHeaders, getRequestOrigin } from "../lib/cors.js";
import { buildSetCookie, signValue } from "../lib/cookies.js";
import { COOKIE_NAME } from "../lib/requestSession.js";
import { createSession } from "../lib/sessionStore.js";
import { CommerceApiError, exchangeAdminCredentials } from "../../server/src/commerce/adobeCommerceClient.js";

export async function main(params) {
  applyEnvInputs(params);
  const corsHeaders = buildCorsHeaders(getRequestOrigin(params));

  if (params.__ow_method === "options") {
    return { statusCode: 200, headers: corsHeaders, body: "{}" };
  }

  let username = "";
  let password = "";

  if (params.username !== undefined) {
    username = String(params.username || "").trim();
    password = String(params.password || "");
  } else if (params.__ow_body) {
    const raw = Buffer.from(params.__ow_body, "base64").toString("utf-8");
    const body = JSON.parse(raw);
    username = String(body.username || "").trim();
    password = String(body.password || "");
  }

  if (!username || !password) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Username and password are required." }),
    };
  }

  try {
    const token = await exchangeAdminCredentials(username, password);
    const { id, expiresAt } = await createSession({ commerceUsername: username, commerceToken: token });
    const setCookie = buildSetCookie(COOKIE_NAME, signValue(id, process.env.SESSION_SECRET), {
      maxAgeSeconds: (expiresAt - Date.now()) / 1000,
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Set-Cookie": setCookie },
      body: JSON.stringify({ username }),
    };
  } catch (error) {
    if (error instanceof CommerceApiError && error.status === 401) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid Commerce admin username or password." }),
      };
    }

    console.error("Login action error:", error);
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Commerce is unreachable right now. Please try again shortly." }),
    };
  }
}
