import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced in the UI too — see app/page.js — but this makes the
  // misconfiguration obvious in the server/build logs as well.
  console.warn(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
    "Set these in your environment (see README) before deploying."
  );
}

export const isSupabaseConfigured = !!(url && anonKey);

export const supabase = createClient(url, anonKey);
