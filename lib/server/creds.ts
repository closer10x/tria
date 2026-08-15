import { supabase } from "@/lib/supabase";
import { Provider } from "@/lib/types";

/**
 * Server-managed email credential store.
 * Lives in app_settings row 2 (row 1 is the client-synced UI settings).
 * Passwords are stored only as AES-256-GCM ciphertext (see lib/server/crypto.ts);
 * the encryption key never leaves the app server.
 */

export type StoredAccount = {
  id: string; // the account email address
  email: string;
  provider: Provider;
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

const ROW_ID = 2;

export async function loadCreds(): Promise<CredData> {
  if (!supabase) return { accounts: [], connectedAccountIds: [] };
  const { data } = await supabase
    .from("app_settings")
    .select("data")
    .eq("id", ROW_ID)
    .maybeSingle();
  const d = (data?.data ?? {}) as Partial<CredData>;
  return {
    accounts: d.accounts ?? [],
    connectedAccountIds: d.connectedAccountIds ?? [],
  };
}

export async function saveCreds(creds: CredData): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured (missing env vars)");
  const { error } = await supabase
    .from("app_settings")
    .upsert({ id: ROW_ID, data: creds, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save accounts: ${error.message}`);
}

/** Public shape sent to the client — never includes ciphertext. */
export function toPublic(a: StoredAccount) {
  const { passwordEnc, ...rest } = a;
  return { ...rest, hasPassword: Boolean(passwordEnc) };
}
