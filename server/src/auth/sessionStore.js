import crypto from "node:crypto";
import db from "../db/db.js";
import { decryptToken, encryptToken } from "./tokenCrypto.js";

export function getIdleTimeoutMs() {
  const minutes = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES) || 480;
  return minutes * 60 * 1000;
}

export function deleteExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

export function createSession({ commerceUsername, commerceToken }) {
  deleteExpiredSessions();

  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + getIdleTimeoutMs();

  db.prepare(
    `INSERT INTO sessions (id, commerce_username, commerce_token, created_at, last_active_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, commerceUsername, encryptToken(commerceToken), now, now, expiresAt);

  return { id, expiresAt };
}

export function getSession(sessionId) {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);

  if (!row) {
    return null;
  }

  if (row.expires_at < Date.now()) {
    deleteSession(sessionId);
    return null;
  }

  return {
    id: row.id,
    commerceUsername: row.commerce_username,
    commerceToken: decryptToken(row.commerce_token),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    expiresAt: row.expires_at,
  };
}

export function touchSession(sessionId) {
  const now = Date.now();
  const expiresAt = now + getIdleTimeoutMs();
  db.prepare("UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ?").run(now, expiresAt, sessionId);
  return expiresAt;
}

export function deleteSession(sessionId) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}
