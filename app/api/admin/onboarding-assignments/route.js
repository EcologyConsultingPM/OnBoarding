import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

async function loadStaff(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return new Map((data?.users || []).map((user) => [user.id, {
    id: user.id,
    name: user.user_metadata?.full_name || user.email || "Unnamed staff member",
    email: user.email || "",
  }]));
}

// GET returns the administrator-only assignment register. It deliberately uses
// the service role only after requireSession confirms the caller is an admin.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);

    const [staffById, modulesResult] = await Promise.all([
      loadStaff(access.admin),
      access.admin
        .from("assigned_modules")
        .select("id, staff_user_id, title, sme, unlocked, created_at, updated_at")
        .order("updated_at", { ascending: false }),
    ]);
    if (modulesResult.error) return jsonError(modulesResult.error.message);

    const modules = (modulesResult.data || []).map((module) => {
      const staff = staffById.get(module.staff_user_id) || {};
      return {
        ...module,
        staff_name: staff.name || "Former or unavailable staff member",
        staff_email: staff.email || "",
        state: module.unlocked ? "active" : "draft",
      };
    });
    return Response.json({ modules });
  } catch (error) {
    return serverError(error);
  }
}

// DELETE removes a selected individual assignment or all assignments for one
// staff member. Foreign-key cascades remove the assignment's topics/progress.
// This is intentionally irreversible and is guarded by a UI confirmation.
export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const body = await request.json();
    const moduleId = typeof body.module_id === "string" ? body.module_id : "";
    const staffUserId = typeof body.staff_user_id === "string" ? body.staff_user_id : "";
    if (!moduleId && !staffUserId) return jsonError("Choose an onboarding assignment to remove.");

    const query = access.admin.from("assigned_modules").delete();
    const { data: removed, error } = moduleId
      ? await query.eq("id", moduleId).select("id, staff_user_id, title")
      : await query.eq("staff_user_id", staffUserId).select("id, staff_user_id, title");
    if (error) return jsonError(error.message);
    if (!(removed || []).length) return jsonError("The onboarding assignment was not found.", 404);

    const eventRows = (removed || []).map((module) => ({
      recipient_id: module.staff_user_id,
      event_type: "onboarding_withdrawn",
      severity: "information",
      title: "Onboarding assignment removed",
      body: `Your onboarding assignment “${module.title}” has been removed. Contact your manager if you need clarification.`,
      href: "/",
      source_table: "assigned_modules",
      source_id: module.id,
    }));
    const eventResult = await access.admin.from("portal_events").insert(eventRows);
    if (eventResult.error) throw new Error(eventResult.error.message);

    return Response.json({ ok: true, removed_count: removed.length });
  } catch (error) {
    return serverError(error);
  }
}
