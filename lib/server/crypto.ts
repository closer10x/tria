import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// AES-256-GCM with a key derived from TRIA_ENC_KEY (.env.local, server-only).
// Ciphertext layout: base64( iv[12] | authTag[16] | data ).
const raw = process.env.TRIA_ENC_KEY ?? "";
const key = raw ? createHash("sha256").update(raw).digest() : null;

export const cryptoReady = key !== null;

export function encrypt(plain: string, aad?: string): string {
  if (!key) throw new Error("TRIA_ENC_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decrypt(blob: string, aad?: string): string {
  if (!key) throw new Error("TRIA_ENC_KEY is not set");
  const buf = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  return Buffer.concat([
    decipher.update(buf.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Binds a stored password to its account + servers: if anyone rewrites the
 * hosts in the (publicly writable) settings row, decryption fails instead of
 * the password being sent to the new host.
 */
export const credAad = (email: string, imapHost: string, smtpHost: string) =>
  `${email}|${imapHost}|${smtpHost}`;
