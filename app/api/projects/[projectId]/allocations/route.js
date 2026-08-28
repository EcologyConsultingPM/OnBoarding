import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { listDirectoryUsers } from "../../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Replace the full allocation list for a project (admin only). Expects
// rows of { staffUserId, roleOnProject, allocatedHours, hourlyRate }.
export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can manage allocations." }, { status: 403 });

    const { data: project } = await access.admin.from("projects").select("id").eq("id", params.projectId).maybeSingle();
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

    const body = await request.json();
    if (!Array.isArray(body.allocations) || body.allocations.length > 100) {
      return Response.json({ error: "Provide no more than 100 allocations." }, { status: 400 });
    }

    // De-duplicate by staff id (unique constraint enforces one row per person).
    const seen = new Set();
    const rows = [];
    for (const a of body.allocations) {
      const staffUserId = typeof a?.staffUserId === "string" ? a.staffUserId.trim() : "";
      if (!staffUserId || seen.has(staffUserId)) continue;
      seen.add(staffUserId);
      rows.push({
        project_id: params.projectId,
        staff_user_id: staffUserId,
        role_on_project: typeof a.roleOnProject === "string" ? a.roleOnProject.trim() || null : null,
        allocated_hours: num(a.allocatedHours),
        hourly_rate: num(a.hourlyRate),
      });
    }

    const directory = await listDirectoryUsers(access.admin, { activeOnly: true });
    const availableIds = new Set(directory.map((person) => person.id));
    if (rows.some((row) => !availableIds.has(row.staff_user_id))) {
      return Response.json({ error: "Project allocations must use available staff from the controlled Staff List." }, { status: 400 });
    }

    await access.admin.from("project_allocations").delete().eq("project_id", params.projectId);
    if (rows.length) {
      const { error } = await access.admin.from("project_allocations").insert(rows);
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ success: true, count: rows.length });
  } catch (error) {
    return serverError(error);
  }
}
