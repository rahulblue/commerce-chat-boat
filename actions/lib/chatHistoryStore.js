import stateLib from "@adobe/aio-lib-state";

const HISTORY_PREFIX = "history_";
// Defensive cap: aio-lib-state's exact per-value size limit isn't confirmed (believed ~1MB),
// so history is kept well under any plausible limit rather than stored unbounded.
const MAX_STORED_MESSAGES = 60;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function readHistory(state, key) {
  const result = await state.get(key);

  if (!result?.value) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export async function appendMessage({ commerceUsername, role, content, toolCalls }) {
  const state = await stateLib.init();
  const key = `${HISTORY_PREFIX}${commerceUsername}`;
  const history = await readHistory(state, key);

  history.push({ role, content, toolCalls: toolCalls || null, createdAt: Date.now() });

  await state.put(key, JSON.stringify(history.slice(-MAX_STORED_MESSAGES)), { ttl: HISTORY_TTL_SECONDS });
}

export async function getRecentMessages(commerceUsername, limit = 6) {
  const state = await stateLib.init();
  const history = await readHistory(state, `${HISTORY_PREFIX}${commerceUsername}`);

  return history.slice(-limit).map((message) => ({ role: message.role, content: message.content }));
}

export async function getAllMessages(commerceUsername, limit = 100) {
  const state = await stateLib.init();
  const history = await readHistory(state, `${HISTORY_PREFIX}${commerceUsername}`);

  return history.slice(-limit).map((message) => ({
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    createdAt: message.createdAt,
  }));
}
