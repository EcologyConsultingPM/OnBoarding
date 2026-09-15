import { requireSession, serverError } from "../../../../lib/serverAuth";
import { createTrackerEntry } from "../../project-tracker-entries/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

// Staff eligible to have an entry logged on their behalf for this project:
// anyone with an active allocation on it, regardless of whether they have
// any tracker entries yet — that's the whole point, they're missing one.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Admin access required.", 403);

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return jsonError("A project id is required.", 400);

    const { data: allocations, error: allocationError } = await access.admin
      .from("project_allocations")
      .select("staff_user_id, active")
      .eq("project_id", projectId)
      .eq("active", true);
    if (allocationError) return jsonError(allocationError.message, 400);

    const staffIds = [...new Set((allocations || []).map((row) => row.staff_user_id).filter(Boolean))];
    if (!staffIds.length) return Response.json({ staff: [], categoryOptions: [] });

    const [usersResult, templateResult] = await Promise.all([
      access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      access.admin.from("project_tracker_templates").select("category_options, locked").eq("project_id", projectId).maybeSingle(),
    ]);
    if (usersResult.error) return jsonError(usersResult.error.message, 400);
    const nameById = new Map((usersResult.data?.users || []).map((user) => [user.id, user.user_metadata?.full_name || user.email || "Staff member"]));

    const staff = staffIds
      .map((id) => ({ id, name: nameById.get(id) || "Staff member" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const categoryOptions = templateResult.data?.locked ? (templateResult.data.category_options || []) : [];

    return Response.json({ staff, categoryOptions });
  } catch (error) {
    return serverError(error);
  }
}

// Body must include staffUserId in addition to everything createTrackerEntry
// normally expects (projectId, sourceId, allocationId, workDate, etc.) — the
// entry is created exactly as if that staff member had submitted it
// themselves, except entered_by_admin_id records who actually did it.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Admin access required.", 403);

    const body = await request.json();
    const staffUserId = String(body?.staffUserId || "");
    if (!staffUserId) return jsonError("Choose which staff member this entry is for.", 400);

    const result = await createTrackerEntry(access, body, staffUserId);
    if (result.error) return jsonError(result.error, result.status || 400);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
