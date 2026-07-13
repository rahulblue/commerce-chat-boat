import db from "../db/db.js";

export function appendMessage({ commerceUsername, role, content, toolCalls }) {
  db.prepare(
    `INSERT INTO chat_messages (commerce_username, role, content, tool_calls, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(commerceUsername, role, content, toolCalls ? JSON.stringify(toolCalls) : null, Date.now());
}

// Ascending-order last `limit` messages — used to feed Claude conversational context.
export function getRecentMessages(commerceUsername, limit = 6) {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM chat_messages WHERE commerce_username = ? ORDER BY id DESC LIMIT ?
       ) sub ORDER BY id ASC`,
    )
    .all(commerceUsername, limit);

  return rows.map((row) => ({ role: row.role, content: row.content }));
}

// Ascending-order last `limit` messages with full display metadata — used to seed the
// frontend's chat window on load.
export function getAllMessages(commerceUsername, limit = 100) {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM chat_messages WHERE commerce_username = ? ORDER BY id DESC LIMIT ?
       ) sub ORDER BY id ASC`,
    )
    .all(commerceUsername, limit);

  return rows.map((row) => ({
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : null,
    createdAt: row.created_at,
  }));
}
