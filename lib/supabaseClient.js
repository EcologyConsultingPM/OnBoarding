import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
    "Set these in your environment (see README) before deploying."
  );
}

export const isSupabaseConfigured = Boolean(url && anonKey);

// A harmless placeholder allows Next.js to compile static routes without
// authenticating. At runtime the app shows its existing configuration warning
// until real Vercel or .env.local values are supplied.
export const supabase = createClient(
  url || "https://placeholder.invalid",
  anonKey || "placeholder-anon-key",
);
