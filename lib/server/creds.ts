import { db, hasServiceKey } from "@/lib/server/db";
import { Provider } from "@/lib/types";

/**
 * Server-managed email credential store.
 * Lives in the `credentials` table — RLS on with no policies, so it is
 * unreachable with the public anon key and requires SUPABASE_SERVICE_ROLE_KEY.
 * A missing key fails loudly rather than degrading to less secure storage.
 * Passwords are stored only as AES-256-GCM ciphertext (see lib/server/crypto.ts);
 * the encryption key never leaves the app server.
 */

export type StoredAccount = {
  id: string; // the account email address
  email: string;
  provider: Provider;
  /** "oauth" accounts authenticate with a token instead of a password. */
  authType?: "password" | "oauth";
  oauthProvider?: "microsoft" | "google";
  refreshTokenEnc?: string;
  accessTokenEnc?: string;
  accessTokenExpiresAt?: number;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  passwordEnc?: string;
};

export type CredData = {
  accounts: StoredAccount[];
  /** Accounts that were live last time — restored automatically on next load. */
  connectedAccountIds: string[];
};

const EMPTY: CredData = { accounts: [], connectedAccountIds: [] };

const normalize = (d: Partial<CredData> | null | undefined): CredData => ({
  accounts: d?.accounts ?? [],
  connectedAccountIds: d?.connectedAccountIds ?? [],
});

function requireServiceKey() {
  if (!hasServiceKey)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — the credential store requires it (see .env.example)"
    );
}

export async function loadCreds(): Promise<CredData> {
  if (!db) return EMPTY; // no Supabase at all: demo mode, no saved accounts
  requireServiceKey();
  const { data } = await db
    .from("credentials")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  return normalize(data?.data as Partial<CredData> | undefined);
}

export async function saveCreds(creds: CredData): Promise<void> {
  if (!db) throw new Error("Supabase is not configured (missing env vars)");
  requireServiceKey();
  const { error } = await db
    .from("credentials")
    .upsert({ id: 1, data: creds, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save accounts: ${error.message}`);
}

/** Public shape sent to the client — never includes ciphertext. */
export function toPublic(a: StoredAccount) {
  const {
    passwordEnc,
    refreshTokenEnc,
    accessTokenEnc,
    accessTokenExpiresAt,
    ...rest
  } = a;
  return {
    ...rest,
    hasPassword: Boolean(passwordEnc),
    isOAuth: a.authType === "oauth" && Boolean(refreshTokenEnc),
  };
}
