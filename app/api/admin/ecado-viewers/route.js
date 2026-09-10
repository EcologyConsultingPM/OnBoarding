import { requireSession, serverError } from "../../../../lib/serverAuth";
import { PRIMARY_ADMIN_EMAILS, isProtectedPrimaryEmail } from "../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}
function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function validStaffEmail(email) {
  return /^[^\s@]+@ecologyconsulting\.au$/i.test(email);
}
function isPrimary(access) {
  return isProtectedPrimaryEmail(access?.user?.email);
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrator access required.", 403);
    if (!isPrimary(access)) return jsonError("Ecado visibility is controlled by Aaron Dooley or Tony Webster.", 403);

    const { data, error } = await access.admin.from("ecado_viewers").select("email, full_name, granted_by, granted_at, revoked_at, note").is("revoked_at", null).order("granted_at", { ascending: true });
    if (error) return jsonError(error.message);

    return Response.json({ viewers: data || [], isPrimary: true, primaryEmails: PRIMARY_ADMIN_EMAILS });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrator access required.", 403);
    if (!isPrimary(access)) return jsonError("Ecado visibility is controlled by Aaron Dooley or Tony Webster.", 403);

    const body = await request.json();
    const email = normaliseEmail(body?.email);
    if (!validStaffEmail(email)) return jsonError("Enter a valid @ecologyconsulting.au staff email.");

    const { data, error } = await access.admin.from("ecado_viewers").upsert({
      email,
      full_name: body?.fullName || null,
      granted_by: normaliseEmail(access.user.email),
      granted_at: new Date().toISOString(),
      revoked_at: null,
      note: body?.note || null,
    }, { onConflict: "email" }).select("email, full_name, granted_by, granted_at").single();
    if (error) return jsonError(error.message);

    return Response.json({ viewer: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrator access required.", 403);
    if (!isPrimary(access)) return jsonError("Ecado visibility is controlled by Aaron Dooley or Tony Webster.", 403);

    const { searchParams } = new URL(request.url);
    const email = normaliseEmail(searchParams.get("email"));
    if (!validStaffEmail(email)) return jsonError("A valid staff email is required.");

    const { error } = await access.admin.from("ecado_viewers").update({ revoked_at: new Date().toISOString() }).eq("email", email);
    if (error) return jsonError(error.message);

    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
