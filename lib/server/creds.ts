import { db, hasServiceKey } from "@/lib/server/db";
import { Provider } from "@/lib/types";

/**
 * Server-managed email credential store.
 * With SUPABASE_SERVICE_ROLE_KEY set, lives in the `credentials` table (RLS on,
 * no policies — unreachable with the public anon key); existing data in the
 * legacy location (app_settings row 2) is migrated over on first read.
 * Without the key, falls back to the legacy row so nothing breaks.
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

const LEGACY_ROW_ID = 2;
const EMPTY: CredData = { accounts: [], connectedAccountIds: [] };

const normalize = (d: Partial<CredData> | null | undefined): CredData => ({
  accounts: d?.accounts ?? [],
  connectedAccountIds: d?.connectedAccountIds ?? [],
});

/** One-time move of legacy app_settings row 2 into the locked table. */
async function migrateLegacy(): Promise<CredData | null> {
  if (!db) return null;
  const { data } = await db
    .from("app_settings")
    .select("data")
    .eq("id", LEGACY_ROW_ID)
    .maybeSingle();
  if (!data) return null;
  const creds = normalize(data.data as Partial<CredData>);
  const { error } = await db
    .from("credentials")
    .upsert({ id: 1, data: creds, updated_at: new Date().toISOString() });
  if (error) return creds; // keep serving from legacy; retry next read
  await db.from("app_settings").delete().eq("id", LEGACY_ROW_ID);
  return creds;
}

export async function loadCreds(): Promise<CredData> {
  if (!db) return EMPTY;
  if (hasServiceKey) {
    const { data } = await db
      .from("credentials")
      .select("data")
      .eq("id", 1)
      .maybeSingle();
    if (data) return normalize(data.data as Partial<CredData>);
    return (await migrateLegacy()) ?? EMPTY;
  }
  const { data } = await db
    .from("app_settings")
    .select("data")
    .eq("id", LEGACY_ROW_ID)
    .maybeSingle();
  return normalize(data?.data as Partial<CredData> | undefined);
}

export async function saveCreds(creds: CredData): Promise<void> {
  if (!db) throw new Error("Supabase is not configured (missing env vars)");
  const { error } = hasServiceKey
    ? await db
        .from("credentials")
        .upsert({ id: 1, data: creds, updated_at: new Date().toISOString() })
    : await db
        .from("app_settings")
        .upsert({
          id: LEGACY_ROW_ID,
          data: creds,
          updated_at: new Date().toISOString(),
        });
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
