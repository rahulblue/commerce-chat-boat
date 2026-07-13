import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = process.env.COMMERCE_TOKEN_ENC_KEY;

  if (!raw) {
    throw new Error("COMMERCE_TOKEN_ENC_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("COMMERCE_TOKEN_ENC_KEY must decode to exactly 32 bytes (base64-encoded).");
  }

  return key;
}

export function encryptToken(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptToken(payload) {
  const key = getKey();
  const [ivB64, authTagB64, dataB64] = String(payload).split(".");

  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed encrypted token payload.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
