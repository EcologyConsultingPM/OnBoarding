import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This route does exactly one thing: clear the must_change_password flag
// for the person calling it, and ONLY for them. It never accepts an email
// or user id from the request body — the target user is derived solely
// from the verified bearer token, so there is no way to clear (or set)
// this flag for anyone else.
export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return Response.json({ error: "Not configured on the server." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Not authenticated." }, { status: 401 });

  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller?.id) {
    return Response.json({ error: "Invalid session." }, { status: 401 });
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.auth.admin.updateUserById(caller.id, {
    app_metadata: { ...caller.app_metadata, must_change_password: false },
  });
  if (error) {
    return Response.json({ error: "Could not update account." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
