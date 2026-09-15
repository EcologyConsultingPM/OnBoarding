import { requireSession, serverError } from "../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}
function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!validId(params.projectId)) return jsonError("A valid project id is required.");

    const { data, error } = await access.admin
      .from("project_deliverables")
      .select("id, project_id, deliverable_type, title, due_date, status, sort_order, created_at")
      .eq("project_id", params.projectId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) return jsonError(error.message);

    return Response.json({ deliverables: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Only administrators can manage deliverables.", 403);
    if (!validId(params.projectId)) return jsonError("A valid project id is required.");

    const body = await request.json();
    const now = new Date().toISOString();

    // Quick Add: create the deliverable AND its full standard activity
    // checklist from a template in one action — this is the actual feature
    // request. Each generated activity is pre-filled with the template's
    // category and title, tagged to the new deliverable, and left
    // unassigned/unscheduled — the PM's remaining job is exactly the four
    // things the spec called out: staff, budget, start date, end date.
    if (body?.templateId) {
      if (!validId(body.templateId)) return jsonError("A valid template id is required.");
      const { data: template, error: templateError } = await access.admin
        .from("deliverable_templates")
        .select("id, code, name, standard_activities")
        .eq("id", body.templateId)
        .maybeSingle();
      if (templateError) return jsonError(templateError.message);
      if (!template) return jsonError("Template not found.", 404);

      const title = String(body.title || template.name).trim();
      const { data: deliverable, error: deliverableError } = await access.admin
        .from("project_deliverables")
        .insert({
          project_id: params.projectId,
          deliverable_type: template.code,
          title,
          due_date: body.dueDate || null,
          created_by: access.user.id,
          created_at: now,
          updated_at: now,
        })
        .select("id, project_id, deliverable_type, title, due_date, status")
        .single();
      if (deliverableError) return jsonError(deliverableError.message);

      const standardActivities = Array.isArray(template.standard_activities) ? template.standard_activities : [];
      const activityRows = standardActivities.map((activity, index) => ({
        project_id: params.projectId,
        deliverable_id: deliverable.id,
        title: activity.title || activity.category || "Activity",
        task_category: activity.category || null,
        status: "not_commenced",
        acceptance_status: "awaiting_response",
        sort_order: index,
        is_active: true,
        created_by: access.user.id,
        created_at: now,
        updated_at: now,
      }));

      let createdActivities = [];
      if (activityRows.length) {
        const { data: inserted, error: activitiesError } = await access.admin
          .from("project_activities")
          .insert(activityRows)
          .select("id, title, task_category, deliverable_id");
        if (activitiesError) return jsonError(`Deliverable created, but activities could not be generated: ${activitiesError.message}`, 500);
        createdActivities = inserted || [];
      }

      return Response.json({ deliverable, activities: createdActivities, templateUsed: template.name }, { status: 201 });
    }

    // Plain manual deliverable, no template.
    const title = String(body?.title || "").trim();
    if (!title) return jsonError("A title is required.");
    const { data, error } = await access.admin
      .from("project_deliverables")
      .insert({
        project_id: params.projectId,
        deliverable_type: body?.deliverableType || null,
        title,
        due_date: body?.dueDate || null,
        created_by: access.user.id,
        created_at: now,
        updated_at: now,
      })
      .select("id, project_id, deliverable_type, title, due_date, status")
      .single();
    if (error) return jsonError(error.message);

    return Response.json({ deliverable: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
