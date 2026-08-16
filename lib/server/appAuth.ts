/**
 * The lock on the front door.
 *
 * Every mail route resolves credentials from the store when no session cookie
 * is present — that is what makes auto-restore work, and it is also why an
 * anonymous caller could reach the mailboxes: possession of the URL was the
 * only thing being checked. This gate puts a shared secret in front of the
 * whole API instead of adding a check to twenty-two routes and hoping the
 * twenty-third remembers.
 *
 * Set TRIA_APP_PASSWORD to arm it. Left unset the app behaves exactly as
 * before, so an existing deployment cannot be locked out by shipping this —
 * but `armed()` is false and callers should say so loudly.
 *
 * Edge-compatible: Web Crypto only, no node:crypto.
 */

const COOKIE = "tria_unlock";
/** How long an unlock lasts before it has to be entered again. */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const UNLOCK_COOKIE = COOKIE;

export const appPassword = () => process.env.TRIA_APP_PASSWORD?.trim() || "";

/** Is the gate actually protecting anything? */
export const armed = () => appPassword().length > 0;

const enc = new TextEncoder();

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Compare without leaking where two strings first differ. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a cookie value for a caller who has proved they know the password. */
export async function issueToken(now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ iat: now })));
  return `${payload}.${await sign(payload, appPassword())}`;
}

export async function verifyToken(
  token: string | undefined,
  now = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  if (!safeEqual(mac, await sign(payload, appPassword()))) return false;
  try {
    const { iat } = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { iat?: number };
    if (typeof iat !== "number") return false;
    return now - iat < MAX_AGE_SECONDS * 1000;
  } catch {
    return false;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
