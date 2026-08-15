import { getAccount, getAccounts, MailConfig, sessions } from "./store";
import { loadCreds, StoredAccount } from "@/lib/server/creds";
import { credAad, cryptoReady, decrypt } from "@/lib/server/crypto";

/**
 * The in-memory session map lives in globalThis, which is per serverless
 * instance: a connect served by one instance is invisible to the send served
 * by the next, so routes that trusted the map alone returned "Not connected"
 * in production. Everything needed to rebuild a session is already in the
 * credential store, so fall back to it and warm the instance on the way past.
 *
 * Decrypted passwords stay inside this module and the in-memory map — they are
 * never returned to a caller that serialises them.
 */

function toConfig(stored: StoredAccount): MailConfig | undefined {
  const base = {
    user: stored.email,
    imapHost: stored.imapHost,
    imapPort: stored.imapPort,
    smtpHost: stored.smtpHost,
    smtpPort: stored.smtpPort,
  };
  if (stored.authType === "oauth" && stored.refreshTokenEnc)
    return { ...base, pass: "", oauthAccountId: stored.id };
  if (stored.passwordEnc) {
    try {
      return {
        ...base,
        pass: decrypt(
          stored.passwordEnc,
          credAad(stored.email, stored.imapHost, stored.smtpHost)
        ),
      };
    } catch {
      return undefined; // tampered or re-hosted record — fail closed
    }
  }
  return undefined;
}

function warm(token: string | undefined, cfg: MailConfig) {
  if (!token) return;
  let open = sessions.get(token);
  if (!open) {
    open = new Map();
    sessions.set(token, open);
  }
  open.set(cfg.user, cfg);
}

/** One account's config, rebuilding from stored credentials when needed. */
export async function resolveAccount(
  token: string | undefined,
  account?: string | null
): Promise<MailConfig | undefined> {
  const live = getAccount(token, account);
  if (live) return live;
  if (!cryptoReady) return undefined;

  const creds = await loadCreds();
  const connected = creds.accounts.filter((a) =>
    creds.connectedAccountIds.includes(a.id)
  );
  const stored = account
    ? creds.accounts.find((a) => a.id === account)
    : // mirror getAccount: fall back only when there's no ambiguity
      connected.length === 1
      ? connected[0]
      : undefined;
  if (!stored) return undefined;

  const cfg = toConfig(stored);
  if (cfg) warm(token, cfg);
  return cfg;
}

/** Every connected account — the unified inbox view. */
export async function resolveAllAccounts(
  token: string | undefined
): Promise<MailConfig[]> {
  const live = getAccounts(token);
  if (live && live.size > 0) return Array.from(live.values());
  if (!cryptoReady) return [];

  const creds = await loadCreds();
  const out: MailConfig[] = [];
  for (const id of creds.connectedAccountIds) {
    const stored = creds.accounts.find((a) => a.id === id);
    if (!stored) continue;
    const cfg = toConfig(stored);
    if (cfg) {
      warm(token, cfg);
      out.push(cfg);
    }
  }
  return out;
}

/** Addresses of connected accounts, without exposing any credential. */
export async function resolveAccountIds(
  token: string | undefined
): Promise<string[]> {
  const live = getAccounts(token);
  if (live && live.size > 0) return Array.from(live.keys());
  const creds = await loadCreds().catch(() => null);
  return creds?.connectedAccountIds ?? [];
}
