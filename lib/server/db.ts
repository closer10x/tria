import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabase as anonClient } from "@/lib/supabase";

// Server-only Supabase client. With SUPABASE_SERVICE_ROLE_KEY set it bypasses
// RLS and can reach the locked `credentials` table; until the key is added we
// fall back to the shared anon client (legacy app_settings row 2 path).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export const hasServiceKey = Boolean(url && serviceKey);

export const db: SupabaseClient | null = hasServiceKey
  ? createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : anonClient;
