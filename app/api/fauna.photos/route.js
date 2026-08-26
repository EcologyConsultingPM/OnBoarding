import { createClient } from "@supabase/supabase-js";

// NOTE: This route authenticates with the SUPABASE_SERVICE_ROLE_KEY and enforces
// access rules explicitly in code (own-record vs is_admin()), rather than relying
// on the fauna_photo_submissions RLS policies at request time — the RLS policies
// still exist as defense-in-depth (see sql/20260825_fauna_photo_submissions.sql).
// If the rest of this app's API routes share a different auth helper
// (e.g. lib/supabaseServer.js), swap the client setup below to match it.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getRequestUser(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { user: null, isAdmin: false };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { user: null, isAdmin: false };
  const email = (data.user.email || "").toLowerCase();
  const { data: adminRow } = await supabase
    .from("admin_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return { user: data.user, isAdmin: !!adminRow };
}

async function enrichEmails(rows) {
  const ids = Array.from(new Set(rows.flatMap((r) => [r.submitted_by, r.reviewed_by]).filter(Boolean)));
  const emailById = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await supabase.auth.admin.getUserById(id);
      if (data?.user?.email) emailById[id] = data.user.email;
    } catch { /* best-effort */ }
  }));
  return rows.map((r) => ({
    ...r,
    submitted_by_email: emailById[r.submitted_by] || null,
    reviewed_by_email: r.reviewed_by ? (emailById[r.reviewed_by] || null) : null,
  }));
}

export async function GET(req) {
  const { user, isAdmin } = await getRequestUser(req);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let query = supabase.from("fauna_photo_submissions").select("*").order("created_at", { ascending: false });
  if (!isAdmin) query = query.eq("submitted_by", user.id);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const submissions = isAdmin ? await enrichEmails(data) : data;
  return Response.json({ submissions });
}

export async function POST(req) {
  const { user } = await getRequestUser(req);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { taxon_name, common_name, photo_data, note } = body || {};
  if (!taxon_name || !photo_data) {
    return Response.json({ error: "Missing taxon_name or photo_data" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("fauna_photo_submissions")
    .insert({
      submitted_by: user.id,
      taxon_name,
      common_name: common_name || null,
      photo_data,
      note: note || null,
      status: "pending",
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ submission: data });
}
