import { db, hasServiceKey } from "@/lib/server/db";
import { cryptoReady, decrypt, encrypt } from "@/lib/server/crypto";

/**
 * AI provider keys entered in the app instead of in the host's dashboard.
 *
 * An env var is only readable by a new build: fixing a bad key means editing
 * it in Vercel, redeploying, and finding out from a 500 whether it worked.
 * A key stored here takes effect on the next request, and the route that
 * writes it authenticates it against the provider first, so a wrong value
 * cannot be saved at all.
 *
 * Storage is row 2 of `credentials` — the same RLS-locked, service-role-only
 * table the mail logins use (row 1). Keys are AES-256-GCM ciphertext bound to
 * their provider, so a row copied between providers fails to decrypt rather
 * than sending one provider's key to another. Row 1 is never touched here:
 * that document has its own load-mutate-save hazards.
 */

export type AiProvider = "anthropic" | "openrouter";

const ROW_ID = 2;

/** Ciphertext per provider, as stored. */
type StoredKeyRow = Partial<Record<AiProvider, string>>;

const aad = (provider: AiProvider) => `ai-key|${provider}`;

function requireStore() {
  if (!db || !hasServiceKey)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — storing a provider key requires it (see .env.example)"
    );
  if (!cryptoReady)
    throw new Error(
      "TRIA_ENC_KEY is not set — a provider key would have to be stored in the clear (see .env.example)"
    );
}

async function loadRow(): Promise<StoredKeyRow> {
  if (!db || !hasServiceKey) return {};
  const { data, error } = await db
    .from("credentials")
    .select("data")
    .eq("id", ROW_ID)
    .maybeSingle();
  // a failed read must not read as "no keys stored", which would silently
  // fall back to the env var the user is trying to replace
  if (error) throw new Error(`Failed to load provider keys: ${error.message}`);
  return (data?.data as StoredKeyRow | undefined) ?? {};
}

/** Which providers have a key stored here. Never returns the keys. */
export async function storedAiProviders(): Promise<AiProvider[]> {
  try {
    const row = await loadRow();
    return (Object.keys(row) as AiProvider[]).filter((p) => row[p]);
  } catch {
    return [];
  }
}

/** Decrypted keys, for the request that is about to use them. */
export async function loadAiKeys(): Promise<Partial<Record<AiProvider, string>>> {
  if (!cryptoReady) return {};
  const row = await loadRow();
  const out: Partial<Record<AiProvider, string>> = {};
  for (const provider of Object.keys(row) as AiProvider[]) {
    const blob = row[provider];
    if (!blob) continue;
    try {
      out[provider] = decrypt(blob, aad(provider));
    } catch {
      // a tampered or wrongly-bound value fails closed: fall through to the
      // env var rather than handing a corrupt string to the provider
    }
  }
  return out;
}

export async function saveAiKey(provider: AiProvider, key: string): Promise<void> {
  requireStore();
  const row = await loadRow();
  row[provider] = encrypt(key, aad(provider));
  const { error } = await db!
    .from("credentials")
    .upsert({ id: ROW_ID, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save the provider key: ${error.message}`);
}

export async function clearAiKey(provider: AiProvider): Promise<void> {
  requireStore();
  const row = await loadRow();
  delete row[provider];
  const { error } = await db!
    .from("credentials")
    .upsert({ id: ROW_ID, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to remove the provider key: ${error.message}`);
}
