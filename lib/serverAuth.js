import { createClient } from "@supabase/supabase-js";
import { isPrimaryAdministrator } from "./portalVisibility";

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase server configuration is incomplete.");
  }

  return { url, anonKey, serviceRoleKey };
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function requireSession(request) {
  const { url, anonKey, serviceRoleKey } = configuration();
  const token = bearerToken(request);
  if (!token) return { error: Response.json({ error: "Not authenticated." }, { status: 401 }) };

  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user?.id || !data.user.email) {
    return { error: Response.json({ error: "Invalid session." }, { status: 401 }) };
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: adminRecord } = await admin
    .from("admin_emails")
    .select("email")
    .ilike("email", data.user.email)
    .maybeSingle();

  return {
    user: data.user,
    // The two protected primary administrators must remain recoverable even if
    // an administrator-register row has not yet been created or was removed.
    isAdmin: Boolean(adminRecord) || isPrimaryAdministrator({ user: data.user }),
    admin,
  };
}

export function serverError(error) {
  console.error(error);
  return Response.json(
    { error: "The server could not complete that request." },
    { status: 500 },
  );
}
