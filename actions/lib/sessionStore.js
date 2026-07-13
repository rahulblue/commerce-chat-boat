import crypto from "node:crypto";
import stateLib from "@adobe/aio-lib-state";
import { decryptToken, encryptToken } from "../../server/src/auth/tokenCrypto.js";

const SESSION_PREFIX = "session_";

export function getIdleTimeoutMs() {
  const minutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES) || 480;
  return minutes * 60 * 1000;
}

export async function createSession({ commerceUsername, commerceToken }) {
  const state = await stateLib.init();
  const id = crypto.randomUUID();
  const now = Date.now();
  const ttlSeconds = Math.ceil(getIdleTimeoutMs() / 1000);
  const expiresAt = now + ttlSeconds * 1000;

  const record = {
    id,
    commerceUsername,
    commerceToken: encryptToken(commerceToken),
    createdAt: now,
    lastActiveAt: now,
    expiresAt,
  };

  await state.put(`${SESSION_PREFIX}${id}`, JSON.stringify(record), { ttl: ttlSeconds });

  return { id, expiresAt };
}

export async function getSession(sessionId) {
  const state = await stateLib.init();
  const result = await state.get(`${SESSION_PREFIX}${sessionId}`);

  if (!result?.value) {
    return null;
  }

  const record = JSON.parse(result.value);

  return {
    id: record.id,
    commerceUsername: record.commerceUsername,
    commerceToken: decryptToken(record.commerceToken),
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    expiresAt: record.expiresAt,
  };
}

// TTL re-applied on every touch acts as native sliding expiration — no manual cleanup needed.
export async function touchSession(sessionId) {
  const state = await stateLib.init();
  const key = `${SESSION_PREFIX}${sessionId}`;
  const result = await state.get(key);

  if (!result?.value) {
    return null;
  }

  const record = JSON.parse(result.value);
  const now = Date.now();
  const ttlSeconds = Math.ceil(getIdleTimeoutMs() / 1000);

  record.lastActiveAt = now;
  record.expiresAt = now + ttlSeconds * 1000;

  await state.put(key, JSON.stringify(record), { ttl: ttlSeconds });

  return record.expiresAt;
}

export async function deleteSession(sessionId) {
  const state = await stateLib.init();
  await state.delete(`${SESSION_PREFIX}${sessionId}`);
}
