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
  /** What to call this account in the UI. Falls back to the address. */
  label?: string;
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
  const { data, error } = await db
    .from("credentials")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  // A failed read MUST NOT masquerade as an empty store: every writer does
  // load → mutate → save on the whole document, so a silent EMPTY here gets
  // written back and wipes all saved logins (which happened once).
  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  return normalize(data?.data as Partial<CredData> | undefined);
}

export async function saveCreds(
  creds: CredData,
  opts?: {
    /** The delete-last-account path is the only writer allowed to empty the store. */
    allowEmpty?: boolean;
  }
): Promise<void> {
  if (!db) throw new Error("Supabase is not configured (missing env vars)");
  requireServiceKey();
  if (creds.accounts.length === 0 && !opts?.allowEmpty) {
    // last line of defense against load-side bugs: never clobber a store
    // that still holds accounts with an accountless document
    const { data, error } = await db
      .from("credentials")
      .select("data")
      .eq("id", 1)
      .maybeSingle();
    const existing = normalize(data?.data as Partial<CredData> | undefined);
    if (!error && existing.accounts.length > 0)
      throw new Error(
        "Refusing to overwrite saved accounts with an empty list — pass allowEmpty to delete them deliberately"
      );
  }
  const { error } = await db
    .from("credentials")
    .upsert({ id: 1, data: creds, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save accounts: ${error.message}`);
}

/**
 * Change ONE account's fields without rewriting the document.
 *
 * saveCreds() writes the whole store from a snapshot the caller loaded
 * earlier, so any writer holding a stale copy silently reverts every account
 * added or changed since — and the automatic token-refresh path writes on its
 * own schedule, from prod and every dev server, against this same single row.
 * That is how a saved account disappeared. This does the merge in one SQL
 * statement, so a refresh can only touch the fields it owns.
 *
 * No-ops when the account isn't in the store (nothing to merge into).
 */
export async function mergeAccount(
  id: string,
  patch: Partial<StoredAccount>
): Promise<void> {
  if (!db) throw new Error("Supabase is not configured (missing env vars)");
  requireServiceKey();
  const { error } = await db.rpc("merge_credential_account", {
    p_id: id,
    p_patch: patch,
  });
  if (error) throw new Error(`Failed to update account: ${error.message}`);
}

/** Mark an account connected (or not) without touching the accounts array. */
export async function setConnected(
  id: string,
  connected: boolean
): Promise<void> {
  if (!db) throw new Error("Supabase is not configured (missing env vars)");
  requireServiceKey();
  const { error } = await db.rpc("set_credential_connected", {
    p_id: id,
    p_connected: connected,
  });
  if (error) throw new Error(`Failed to update account: ${error.message}`);
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
