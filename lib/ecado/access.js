/**
 * Ecado — access control.
 *
 * The domain is hidden, so an unauthorised request gets 404, not 403 — a
 * 403 confirms the route exists, which is an information leak on a domain
 * meant to be invisible. Runs server-side on every API call. Does not
 * trust localStorage, the client-side admin_emails lookup, or any header
 * other than the Authorization Bearer token this app already uses
 * everywhere else (see lib/serverAuth.js's requireSession).
 */

import { requireSession } from "../serverAuth";
import { writerClient } from "./supabase-server";

/** API guard. Call first in every Ecado route. Returns a plain 404 for anyone not allow-listed. */
export async function requireEcadoViewerApi(request) {
  const access = await requireSession(request);
  if (access.error || !access.user?.email) {
    return { ok: false, response: new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }) };
  }

  const { data, error } = await access.admin
    .from("ecado_viewers")
    .select("email, full_name, revoked_at")
    .ilike("email", access.user.email)
    .maybeSingle();

  if (error || !data || data.revoked_at) {
    await logAccessDenied(access.user.email);
    return { ok: false, response: new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } }) };
  }

  return { ok: true, viewer: { email: data.email, fullName: data.full_name || null } };
}

async function logAccessDenied(email) {
  try {
    await writerClient().from("ecado_audit_log").insert({ user_email: email, action: "access.denied", detail: { reason: "not_allow_listed" } });
  } catch {
    // Audit failure must not leak the existence of the domain to the caller.
  }
}

export async function auditEcado(userEmail, action, detail, sourcesRead = []) {
  try {
    await writerClient().from("ecado_audit_log").insert({ user_email: userEmail, action, detail, sources_read: sourcesRead });
  } catch (err) {
    console.error("[ecado] audit write failed", err);
  }
}
