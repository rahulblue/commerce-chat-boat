const BRIDGED_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ADOBE_COMMERCE_BASE_URL",
  "ADOBE_COMMERCE_REST_PREFIX",
  "ADOBE_COMMERCE_ADMIN_TOKEN",
  "SESSION_SECRET",
  "COMMERCE_TOKEN_ENC_KEY",
  "SESSION_IDLE_TIMEOUT_MINUTES",
  "CLIENT_ORIGIN",
];

// App Builder passes action inputs as top-level params — bridge into process.env so the
// shared server/src modules (written for a long-running Node process) keep working unchanged.
export function applyEnvInputs(params, vars = BRIDGED_VARS) {
  vars.forEach((name) => {
    if (params[name] !== undefined && params[name] !== null && params[name] !== "") {
      process.env[name] = params[name];
    }
  });
}
