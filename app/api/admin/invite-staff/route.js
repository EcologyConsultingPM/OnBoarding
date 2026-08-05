import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DOMAIN = "@ecologyconsulting.au";

// Unambiguous character set (no 0/O, 1/l/I) — read out over the phone or
// typed from a sticky note without confusion.
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function generateTempPassword(length = 14) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CHARS[bytes[i] % CHARS.length];
  return out;
}

async function requireAdmin(request, admin) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: "Not authenticated.", status: 401 };

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller?.email) return { error: "Invalid session.", status: 401 };

  const { data: adminRow } = await admin.from("admin_emails").select("email").ilike("email", caller.email).maybeSingle();
  if (!adminRow) return { error: "Admin access required.", status: 403 };

  return { caller };
}

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ error: "Not configured on the server." }, { status: 503 });
  }
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { error: authError, status } = await requireAdmin(request, admin);
  if (authError) return Response.json({ error: authError }, { status });

  let email, customPassword, forceChange;
  try {
    const body = await request.json();
    email = String(body?.email || "").trim().toLowerCase();
    customPassword = typeof body?.password === "string" ? body.password : null;
    forceChange = body?.forceChange !== false; // default true unless explicitly turned off
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!email || !email.endsWith(ALLOWED_DOMAIN)) {
    return Response.json({ error: `Only ${ALLOWED_DOMAIN} email addresses can be invited.` }, { status: 400 });
  }
  if (customPassword && customPassword.length < 8) {
    return Response.json({ error: "Custom password must be at least 8 characters." }, { status: 400 });
  }

  const tempPassword = customPassword || generateTempPassword();

  // Does this person already have an account? Page through (small roster).
  let existing = null;
  let page = 1;
  while (page <= 20 && !existing) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return Response.json({ error: "Could not check existing accounts." }, { status: 500 });
    existing = data.users.find((u) => (u.email || "").toLowerCase() === email) || null;
    if (data.users.length < 200) break;
    page++;
  }

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: tempPassword,
      app_metadata: { ...existing.app_metadata, must_change_password: forceChange },
    });
    if (error) return Response.json({ error: "Could not reset this account." }, { status: 500 });
  } else {
    const { error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { must_change_password: forceChange },
    });
    if (error) return Response.json({ error: "Could not create this account." }, { status: 500 });
  }

  // Returned once, to the verified admin who made this request. Relay it to
  // the staff member out of band (Slack, in person, phone) — it's never
  // emailed automatically and never stored anywhere after this response.
  return Response.json({ ok: true, email, tempPassword });
}
