import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DOMAIN = "@ecologyconsulting.au";

// Derive a display name from an email local part, e.g.
// "aaron.dooley@ecologyconsulting.au" -> "Aaron Dooley".
function nameFromEmail(email) {
  const local = (email || "").split("@")[0] || "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || email;
}

async function listAllUsers(admin) {
  const users = [];
  let page = 1;
  while (page <= 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
    page++;
  }
  return users;
}

export async function GET(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mqgumjgotjiphfgqdyyl.supabase.co";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_aLAwL1CqWMwukL7c9Zg2QQ_1mfB2JjY";
  if (!url || !serviceKey) {
    return Response.json({ error: "Staff directory is not configured on the server." }, { status: 503 });
  }
  // 1) Verify the caller's session token.
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Not authenticated." }, { status: 401 });
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller?.email) {
    return Response.json({ error: "Invalid session." }, { status: 401 });
  }
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  // 2) Confirm the caller is an admin.
  const { data: adminRow } = await admin
    .from("admin_emails")
    .select("email")
    .ilike("email", caller.email)
    .maybeSingle();
  if (!adminRow) {
    return Response.json({ error: "Admin access required." }, { status: 403 });
  }
  // 3) Gather the roster, the set of admins, per-user progress, and the
  //    total number of onboarding checklist items (section items only).
  const [users, adminsRes, progressRes, sectionItemsRes] = await Promise.all([
    listAllUsers(admin),
    admin.from("admin_emails").select("email"),
    admin.from("staff_progress").select("user_id, done"),
    admin.from("checklist_items").select("id").not("section_id", "is", null),
  ]);
  const adminSet = new Set((adminsRes.data || []).map((a) => (a.email || "").toLowerCase()));
  const total = (sectionItemsRes.data || []).length;
  const doneByUser = {};
  (progressRes.data || []).forEach((p) => {
    if (!doneByUser[p.user_id]) doneByUser[p.user_id] = 0;
    if (p.done) doneByUser[p.user_id] += 1;
  });
  const staff = users
    .filter((u) => (u.email || "").toLowerCase().endsWith(ALLOWED_DOMAIN))
    .filter((u) => u.last_sign_in_at) // only people who have actually signed in
    .map((u) => {
      const email = (u.email || "").toLowerCase();
      const done = doneByUser[u.id] || 0;
      return {
        id: u.id,
        email,
        name: nameFromEmail(email),
        isAdmin: adminSet.has(email),
        done,
        total,
        percent: total ? Math.round((done / total) * 100) : 0,
        lastSignIn: u.last_sign_in_at,
        createdAt: u.created_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return Response.json({ staff, total });
}
