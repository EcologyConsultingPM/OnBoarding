import { requireSession, serverError } from "../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set([
  "not_started",
  "initiated",
  "awaiting_reviews",
  "awaiting_manager_approval",
  "closed",
  "archived",
]);
const ACTION_STATUSES = new Set([
  "draft",
  "assigned",
  "in_progress",
  "completed",
  "verified",
  "archived",
]);

function text(value) {
  const valueText = typeof value === "string" ? value.trim() : "";
  return valueText || null;
}

function score(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

async function loadProject(access, projectId) {
  const { data, error } = await access.admin
    .from("projects")
    .select("id, name, status, project_lead_user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function ensureCloseout(access, projectId, userId) {
  const { data, error } = await access.admin
    .from("project_closeouts")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  const { data: created, error: createError } = await access.admin
    .from("project_closeouts")
    .insert({ project_id: projectId, created_by: userId, updated_by: userId })
    .select("*")
    .single();
  if (createError) throw new Error(createError.message);
  return created;
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can view project close-out records." }, { status: 403 });
    const project = await loadProject(access, params.projectId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

    const [closeoutResult, actionsResult, feedbackResult] = await Promise.all([
      access.admin.from("project_closeouts").select("*").eq("project_id", params.projectId).maybeSingle(),
      access.admin.from("project_improvement_actions").select("*").eq("project_id", params.projectId).eq("is_active", true).order("due_date", { ascending: true, nullsFirst: false }).limit(200),
      access.admin.from("project_closeout_feedback").select("id, closeout_id, staff_user_id, response, status, submitted_at, created_at, updated_at").limit(200),
    ]);
    const error = closeoutResult.error || actionsResult.error || feedbackResult.error;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const closeout = closeoutResult.data || null;
    const feedback = closeout ? (feedbackResult.data || []).filter((row) => row.closeout_id === closeout.id) : [];
    return Response.json({ project, closeout, actions: actionsResult.data || [], feedback });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can update project close-out records." }, { status: 403 });
    const project = await loadProject(access, params.projectId);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const body = await request.json();
    const now = new Date().toISOString();

    if (body.action === "upsert_improvement") {
      const title = text(body.title);
      if (!title) return Response.json({ error: "An improvement action title is required." }, { status: 400 });
      const actionStatus = ACTION_STATUSES.has(body.status) ? body.status : "draft";
      const values = {
        project_id: params.projectId,
        closeout_id: text(body.closeoutId),
        title,
        description: text(body.description),
        assigned_to: text(body.assignedTo),
        status: actionStatus,
        due_date: text(body.dueDate),
        updated_by: access.user.id,
        updated_at: now,
      };
      if (body.actionId) {
        const { data, error } = await access.admin.from("project_improvement_actions").update(values).eq("id", body.actionId).eq("project_id", params.projectId).eq("is_active", true).select("*").single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        return Response.json({ action: data });
      }
      const { data, error } = await access.admin.from("project_improvement_actions").insert({ ...values, created_by: access.user.id }).select("*").single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ action: data }, { status: 201 });
    }

    if (body.action === "archive_improvement") {
      if (!body.actionId) return Response.json({ error: "An improvement action is required." }, { status: 400 });
      const { data, error } = await access.admin.from("project_improvement_actions").update({ is_active: false, status: "archived", updated_by: access.user.id, updated_at: now }).eq("id", body.actionId).eq("project_id", params.projectId).select("id, status, is_active").single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ action: data });
    }

    const nextStatus = STATUSES.has(body.status) ? body.status : "not_started";
    const existing = await ensureCloseout(access, params.projectId, access.user.id);
    if (existing.locked_at && nextStatus !== "archived") return Response.json({ error: "This close-out is locked and must be reopened by an administrator before editing." }, { status: 409 });
    const update = {
      status: nextStatus,
      success_score: score(body.successScore),
      client_outcome: text(body.clientOutcome),
      delivery_summary: text(body.deliverySummary),
      lessons_learned: text(body.lessonsLearned),
      stakeholder_feedback: text(body.stakeholderFeedback),
      financial_review_notes: text(body.financialReviewNotes),
      recommendations: text(body.recommendations),
      approval_note: text(body.approvalNote),
      initiated_at: nextStatus !== "not_started" ? (existing.initiated_at || now) : existing.initiated_at,
      approved_at: nextStatus === "closed" ? (existing.approved_at || now) : existing.approved_at,
      approved_by: nextStatus === "closed" ? (existing.approved_by || access.user.id) : existing.approved_by,
      locked_at: nextStatus === "closed" ? (existing.locked_at || now) : existing.locked_at,
      locked_by: nextStatus === "closed" ? (existing.locked_by || access.user.id) : existing.locked_by,
      updated_by: access.user.id,
      updated_at: now,
    };
    const { data, error } = await access.admin.from("project_closeouts").update(update).eq("id", existing.id).select("*").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ closeout: data });
  } catch (error) {
    return serverError(error);
  }
}
