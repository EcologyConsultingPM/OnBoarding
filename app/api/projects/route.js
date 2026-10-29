import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS =
  "id, name, client_name, client_contact, sharepoint_link, sharepoint_label, description, scope_of_works, project_lead_user_id, start_date, end_date, budget_hours, budget_dollars, default_hourly_rate, status, deleted_at, deleted_by, created_at, updated_at";

function opt(value) {
  const t = typeof value === "string" ? value.trim() : "";
  return t || null;
}
function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The assignment relation is optional until the multi-assignee migration is
// applied. Staff must keep their existing scalar-assignment project list while
// a tenant's table or schema cache is unavailable.
function assignmentTableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || message.includes("project_activity_assignees") || message.includes("schema cache") || message.includes("does not exist");
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const params = new URL(request.url).searchParams;
    const staffWorkspace = params.get("audience") === "staff";
    // ?view=trash returns soft-deleted projects for the administrator recycle
    // bin. Everything else excludes them. Staff never see deleted projects
    // regardless of what they ask for.
    const trashView = params.get("view") === "trash" && access.isAdmin && !staffWorkspace;

    let query = access.admin
      .from("projects")
      .select(COLUMNS)
      .order(trashView ? "deleted_at" : "updated_at", { ascending: false });

    query = trashView ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

    // This route uses the server-side service client, so database RLS does not
    // apply here. Enforce the project-team boundary explicitly whenever the
    // Staff workspace calls this endpoint — including when a protected
    // administrator is using their own Staff portal view.
    if (!access.isAdmin || staffWorkspace) {
      query = query.eq("status", "active");
      const [allocationResult, activityResult, assignmentResult] = await Promise.all([
        access.admin
          .from("project_allocations")
          .select("project_id")
          .eq("staff_user_id", access.user.id)
          .neq("active", false),
        access.admin
          .from("project_activities")
          .select("project_id")
          .eq("staff_user_id", access.user.id)
          .eq("is_active", true)
          .in("acceptance_status", ["accepted", "actioned"]),
        access.admin
          .from("project_activity_assignees")
          .select("activity_id")
          .eq("staff_user_id", access.user.id)
          .neq("acceptance_status", "removed")
          .in("acceptance_status", ["accepted", "actioned"]),
      ]);
      if (allocationResult.error) return Response.json({ error: allocationResult.error.message }, { status: 400 });
      if (activityResult.error) {
        const missingConnectedFields = activityResult.error?.code === "42703" || /is_active/i.test(String(activityResult.error?.message || ""));
        if (!missingConnectedFields) return Response.json({ error: activityResult.error.message }, { status: 400 });
        const fallback = await access.admin
          .from("project_activities")
          .select("project_id")
          .eq("staff_user_id", access.user.id);
        if (fallback.error) return Response.json({ error: fallback.error.message }, { status: 400 });
        activityResult.data = fallback.data;
      }
      if (assignmentResult.error && !assignmentTableUnavailable(assignmentResult.error)) return Response.json({ error: assignmentResult.error.message }, { status: 400 });
      let assignedActivityRows = [];
      if (!assignmentResult.error && (assignmentResult.data || []).length) {
        const { data, error: assignmentActivityError } = await access.admin
          .from("project_activities")
          .select("project_id")
          .in("id", (assignmentResult.data || []).map((row) => row.activity_id))
          .eq("is_active", true);
        if (assignmentActivityError) return Response.json({ error: assignmentActivityError.message }, { status: 400 });
        assignedActivityRows = data || [];
      }
      // With the join table available, only each person's own accepted/actioned
      // assignment grants project-list visibility. The parent status is legacy
      // fallback only; it cannot approve a different shared assignee.
      const activityMembership = assignmentResult.error ? activityResult.data || [] : assignedActivityRows;
      const projectIds = [...new Set([
        ...(allocationResult.data || []).map((row) => row.project_id),
        ...activityMembership.map((row) => row.project_id),
      ].filter(Boolean))];
      if (!projectIds.length) return Response.json({ projects: [] });
      query = query.in("id", projectIds);
    }

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ projects: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can create projects." }, { status: 403 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return Response.json({ error: "A project name is required." }, { status: 400 });

    const { data, error } = await access.admin
      .from("projects")
      .insert({
        created_by: access.user.id,
        name,
        client_name: opt(body.clientName),
        client_contact: opt(body.clientContact),
        sharepoint_link: opt(body.sharepointLink),
        sharepoint_label: opt(body.sharepointLabel),
        description: opt(body.description),
        scope_of_works: opt(body.scopeOfWorks),
        project_lead_user_id: opt(body.projectLeadUserId),
        start_date: opt(body.startDate),
        end_date: opt(body.endDate),
        budget_hours: num(body.budgetHours),
        budget_dollars: num(body.budgetDollars),
        default_hourly_rate: num(body.defaultHourlyRate),
        status: opt(body.status) || "active",
      })
      .select(COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ project: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
