import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../../lib/portalVisibility";
import {
  CLOSEOUT_PROJECT_COLUMNS, CloseoutError, MASTER_ACTIONS, closeoutErrorResponse,
  closeoutRows, closeoutTeam, prepareCloseoutMutation, validCloseoutId,
} from "../../../../../lib/projectCloseoutServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request, params) {
  const access = await requireSession(request);
  if (access.error) return { response: access.error };
  const { projectId } = await params;
  validCloseoutId(projectId);
  const staffAudience = new URL(request.url).searchParams.get("audience") === "staff" || !access.isAdmin;
  const canManage = access.isAdmin && !staffAudience;
  const permission = await requirePortalResource(access, canManage ? "admin.projects" : "staff.notifications");
  if (permission) return { response: permission };
  const { data: project, error } = await access.admin.from("projects").select(CLOSEOUT_PROJECT_COLUMNS).eq("id", projectId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  // Do not reveal project names, status or whether a close-out exists to an
  // uninvited user. An admin deliberately using the staff workspace is scoped too.
  if (!project) throw new CloseoutError("Project not found.", 404, "NOT_FOUND");
  const { data: closeout, error: closeoutError } = await access.admin.from("project_closeouts").select("*").eq("project_id", projectId).maybeSingle();
  if (closeoutError) throw closeoutError;
  let invitation = null;
  let team = null;
  if (!canManage) {
    if (!closeout) throw new CloseoutError("You do not have an invitation to this project close-out.", 403, "NOT_INVITED");
    const { data, error: invitationError } = await access.admin.from("project_closeout_invitations").select("*").eq("closeout_id", closeout.id).eq("staff_user_id", access.user.id).eq("review_round", closeout.review_round || 1).limit(1).maybeSingle();
    if (invitationError) throw invitationError;
    if (!data) throw new CloseoutError("You do not have an invitation to this project close-out.", 403, "NOT_INVITED");
    // Test current allocation/assignment/lead membership, never invitation alone.
    const { data: member, error: memberError } = await access.admin.rpc("project_closeout_is_team_member", { p_project_id: projectId, p_user_id: access.user.id });
    if (memberError) throw memberError;
    if (!member) throw new CloseoutError("You are no longer a current member of this project team.", 403, "NOT_TEAM");
    invitation = data;
    team = []; // Staff must not receive the project-wide identity/email directory.
  }
  return { access, projectId, project, closeout, invitation, team, canManage, staffAudience };
}

export async function GET(request, { params }) {
  try {
    const ctx = await context(request, params);
    if (ctx.response) return ctx.response;
    const { access, project, projectId, closeout, canManage, invitation } = ctx;
    const [feedback, actionsResult, team] = await Promise.all([
      closeout ? closeoutRows(access.admin, "project_closeout_feedback", closeout.id, canManage ? null : access.user.id) : [],
      canManage ? access.admin.from("project_improvement_actions").select("*").eq("project_id", projectId).eq("is_active", true).order("due_date", { ascending: true, nullsFirst: false }).limit(500) : { data: [] },
      canManage ? closeoutTeam(access.admin, project) : ctx.team,
    ]);
    if (actionsResult.error) throw actionsResult.error;
    const invitations = canManage && closeout ? await closeoutRows(access.admin, "project_closeout_invitations", closeout.id) : undefined;
    // An invitation grants access to the shared template, not historical internal
    // financial commentary or administrative override reasons. Redact on the
    // server rather than merely hiding those fields in the staff interface.
    const visibleCloseout = closeout && (canManage ? closeout : Object.fromEntries([
      "id", "project_id", "status", "report_data", "report_revision", "review_round",
      "locked_at", "approved_at", "created_at", "updated_at",
    ].map((key) => [key, closeout[key]])));
    return Response.json({ project, closeout: visibleCloseout ? { ...visibleCloseout, report_data: visibleCloseout.report_data ?? null, report_revision: visibleCloseout.report_revision ?? 0 } : null, actions: actionsResult.data || [], feedback, team, canManage, invitation, ...(canManage ? { invitations } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return closeoutErrorResponse(error) || serverError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const ctx = await context(request, params);
    if (ctx.response) return ctx.response;
    // Bound the body before parsing to avoid unbounded user-controlled JSON work.
    // This also accommodates all capped rows at their maximum text length and
    // JSON/unicode escaping overhead; valid template fields are not truncated.
    if (Number(request.headers.get("content-length") || 0) > 32_000_000) throw new CloseoutError("The close-out request is too large.", 413, "PAYLOAD_TOO_LARGE");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 32_000_000) throw new CloseoutError("The close-out request is too large.", 413, "PAYLOAD_TOO_LARGE");
    let body;
    try { body = JSON.parse(raw); } catch { throw new CloseoutError("Request body must be valid JSON."); }
    const mutation = prepareCloseoutMutation(body, ctx.project);
    const ownResponse = ["save_feedback", "submit_feedback"].includes(mutation.action);
    if (!ctx.canManage && !ownResponse) throw new CloseoutError("Only authorised project administrators can manage the master report.", 403, "FORBIDDEN");
    // Even administrators must explicitly enter the recipient-scoped workspace
    // before submitting a personal response; admin rights are not an invitation.
    if (ownResponse && ctx.canManage) throw new CloseoutError("Open your invited staff report to submit your own response.", 403, "NOT_INVITED");
    if (mutation.action === "invite_team") {
      const team = await closeoutTeam(ctx.access.admin, ctx.project);
      const allowed = new Set(team.map((person) => person.id));
      if (mutation.payload.staffUserIds.some((id) => !allowed.has(id))) throw new CloseoutError("Invitations may only be sent to current project team members.", 403, "NOT_TEAM");
    }
    const { data, error } = await ctx.access.admin.rpc("mutate_project_closeout", {
      p_project_id: ctx.projectId,
      p_actor_id: ctx.access.user.id,
      p_action: mutation.action,
      p_expected_revision: MASTER_ACTIONS.has(mutation.action) ? mutation.expectedRevision : null,
      p_payload: mutation.payload,
      p_staff_audience: ctx.staffAudience,
    });
    if (error) throw error;
    return Response.json(data, { status: mutation.action === "upsert_improvement" && !mutation.payload.actionId ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return closeoutErrorResponse(error) || serverError(error);
  }
}
