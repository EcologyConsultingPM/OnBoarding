/**
 * Ecado — Supabase server clients.
 *
 * Two trust levels, matching this app's existing Bearer-token session
 * pattern (see lib/serverAuth.js) rather than the cookie-based helper the
 * source kit assumed — this app has no cookie-based Supabase client
 * anywhere else, so introducing one here would be a second, inconsistent
 * auth mechanism for no benefit.
 *
 *   readerClient()  service URL/anon key, but every query runs as the
 *                   SELECT-only `ecado_reader` Postgres role via a
 *                   short-lived minted JWT. Cannot write, by database grant.
 *   writerClient()  service key, restricted by convention (assertWritable)
 *                   to ecado_* tables only.
 */

import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Read-only client for business data. PostgREST takes the Postgres role
 * from the `role` claim in the JWT — we mint a short-lived token claiming
 * `ecado_reader`, which holds SELECT and nothing else (see the migration).
 * This is the actual enforcement behind "Ecado never changes records": a
 * write attempt fails at the database, not at the prompt. If the JWT
 * secret is absent, this fails closed rather than falling back to a
 * write-capable key.
 */
export function readerClient() {
  const token = mintReaderToken();
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, "X-Client-Info": "ecado-reader" } },
  });
}

function mintReaderToken() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SUPABASE_JWT_SECRET is not set. Ecado will not read business data with a write-capable key. Set the secret (Supabase dashboard \u2192 Settings \u2192 API \u2192 JWT Secret) or leave Ecado disabled.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ role: "ecado_reader", iss: "ecado", iat: now, exp: now + 300 });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Writer for ecado_* tables only: escalations, briefs, audit log, thresholds. */
export function writerClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "ecado-writer" } },
  });
}

/** Tables the writer is permitted to touch. Guard against scope creep in review. */
export const WRITABLE_TABLES = ["ecado_escalations", "ecado_briefs", "ecado_audit_log", "ecado_thresholds"];

export function assertWritable(table) {
  if (!WRITABLE_TABLES.includes(table)) {
    throw new Error(`Ecado attempted to write to "${table}". Ecado writes only to ecado_* tables. Humans update business records in the source module.`);
  }
}
