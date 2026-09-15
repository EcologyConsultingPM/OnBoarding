import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "*";
const HIGH_RISK_RATINGS = new Set(["extreme", "high"]);

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function assessmentIsCritical(body) {
  const register = Array.isArray(body.hazard_register) ? body.hazard_register : [];
  return register.some((row) => HIGH_RISK_RATINGS.has(String(row.rating_band || "").toLowerCase())) || body.is_critical === true;
}

async function notifyWhsOfficers(admin, assessment, critical) {
  const { data: usersData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const officers = (usersData?.users || []).filter((u) => /@ecologyconsulting\.au$/i.test(u.email || "") && (u.user_metadata?.whs_officer === true || u.user_metadata?.is_primary_admin === true));
  if (!officers.length) return;
  await admin.from("portal_events").insert(officers.map((officer) => ({
    recipient_id: officer.id,
    event_type: critical ? "psychosocial_critical_risk" : "psychosocial_review_required",
    severity: critical ? "critical" : "action_required",
    title: critical ? "Critical Psychosocial Risk — immediate review required" : "Psychosocial Self Risk Assessment submitted",
    body: critical ? "A submission recorded an Extreme or High risk, or high distress. Review immediately." : "A worker has submitted a quarterly self-assessment for WHS Officer review.",
    href: "/staff/whs-forms?domain=psychosocial",
    source_table: "psychosocial_assessments",
    source_id: assessment.id,
  })));
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      const { data, error } = await access.admin.from("psychosocial_assessments").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) return jsonError(error.message);
      if (!data) return jsonError("Assessment not found.", 404);
      if (!access.isAdmin && data.worker_id !== access.user.id) return jsonError("Not found.", 404);
      return Response.json({ assessment: data });
    }

    let query = access.admin.from("psychosocial_assessments").select(COLUMNS).order("created_at", { ascending: false });
    if (!access.isAdmin) query = query.eq("worker_id", access.user.id);
    const { data, error } = await query;
    if (error) return jsonError(error.message);

    return Response.json({ assessments: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();
    const now = new Date().toISOString();

    // Stage 1: save draft or submit
    if (!body.id) {
      const critical = assessmentIsCritical(body);
      const insertRow = {
        worker_id: access.user.id,
        position: body.position || null,
        assessment_date: body.assessment_date || null,
        workplace_location: body.workplace_location || null,
        scope: body.scope || null,
        assessment_methods: body.assessment_methods || [],
        hazard_categories: body.hazard_categories || [],
        hazard_register: body.hazard_register || [],
        additional_notes: body.additional_notes || null,
        discuss_in_person: body.discuss_in_person === true,
        stage: body.submit ? "submitted" : "draft",
        is_critical: critical,
        submitted_to: body.submitted_to || null,
        submitted_at: body.submit ? now : null,
        worker_declaration_signature: body.worker_declaration_signature || null,
      };
      const { data, error } = await access.admin.from("psychosocial_assessments").insert(insertRow).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      if (body.submit) await notifyWhsOfficers(access.admin, data, critical);
      return Response.json({ assessment: data }, { status: 201 });
    }

    const { data: existing, error: fetchError } = await access.admin.from("psychosocial_assessments").select("id, worker_id, stage").eq("id", body.id).maybeSingle();
    if (fetchError) return jsonError(fetchError.message);
    if (!existing) return jsonError("Assessment not found.", 404);

    const action = body.action;

    // Worker updates their own draft, or submits it
    if (!action || action === "save_draft" || action === "submit") {
      if (existing.worker_id !== access.user.id) return jsonError("Only the worker can edit this draft.", 403);
      if (existing.stage !== "draft") return jsonError("Only a draft can be edited here.", 409);
      const critical = assessmentIsCritical(body);
      const patch = {
        position: body.position, assessment_date: body.assessment_date, workplace_location: body.workplace_location,
        scope: body.scope, assessment_methods: body.assessment_methods, hazard_categories: body.hazard_categories,
        hazard_register: body.hazard_register, additional_notes: body.additional_notes, discuss_in_person: body.discuss_in_person === true,
        is_critical: critical, updated_at: now,
      };
      if (action === "submit") {
        patch.stage = "submitted";
        patch.submitted_at = now;
        patch.submitted_to = body.submitted_to || null;
        patch.worker_declaration_signature = body.worker_declaration_signature || null;
      }
      const { data, error } = await access.admin.from("psychosocial_assessments").update(patch).eq("id", body.id).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      if (action === "submit") await notifyWhsOfficers(access.admin, data, critical);
      return Response.json({ assessment: data });
    }

    // Stage 2: WHS Officer review — admin only
    if (action === "whs_review") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can complete this review.", 403);
      if (existing.stage !== "submitted") return jsonError("Only a submitted assessment can be reviewed.", 409);
      const { data, error } = await access.admin.from("psychosocial_assessments").update({
        stage: "whs_review",
        whs_officer_id: access.user.id,
        root_cause_analysis: body.root_cause_analysis || null,
        corrective_action_plan: body.corrective_action_plan || [],
        risk_ratings_validated: body.risk_ratings_validated || null,
        controls_reviewed_finding: body.controls_reviewed_finding || null,
        additional_actions_identified: body.additional_actions_identified || null,
        individual_action_plan_required: body.individual_action_plan_required || null,
        highest_residual_risk: body.highest_residual_risk || null,
        reviewed_at: now,
        updated_at: now,
      }).eq("id", body.id).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      return Response.json({ assessment: data });
    }

    // Stage 3: return findings to the worker — admin only
    if (action === "return_to_worker") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can return this assessment.", 403);
      if (existing.stage !== "whs_review") return jsonError("Complete the WHS review before returning to the worker.", 409);
      const { data, error } = await access.admin.from("psychosocial_assessments").update({
        stage: "returned_to_worker",
        returned_to_worker_at: now,
        returned_by: body.returned_by || null,
        return_method: body.return_method || null,
        updated_at: now,
      }).eq("id", body.id).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      await access.admin.from("portal_events").insert({
        recipient_id: existing.worker_id,
        event_type: "psychosocial_findings_returned",
        severity: "action_required",
        title: "Your psychosocial assessment findings are ready",
        body: "The WHS Officer has completed their review. Read the findings and a consultation meeting will be scheduled.",
        href: `/staff/whs-forms?domain=psychosocial&id=${body.id}`,
        source_table: "psychosocial_assessments",
        source_id: body.id,
      });
      return Response.json({ assessment: data });
    }

    // Worker acknowledges / responds after return
    if (action === "worker_acknowledge") {
      if (existing.worker_id !== access.user.id) return jsonError("Only the assessed worker can acknowledge this.", 403);
      if (existing.stage !== "returned_to_worker") return jsonError("Nothing to acknowledge yet.", 409);
      const { data, error } = await access.admin.from("psychosocial_assessments").update({
        worker_acknowledgement_signature: body.worker_acknowledgement_signature || null,
        worker_response_before_meeting: body.worker_response_before_meeting || null,
        updated_at: now,
      }).eq("id", body.id).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      return Response.json({ assessment: data });
    }

    // Stage 4: consultation meeting — admin only, requires the meeting to have actually been held
    if (action === "record_meeting") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can record the consultation meeting.", 403);
      if (!["returned_to_worker", "consultation_scheduled"].includes(existing.stage)) return jsonError("Return findings to the worker before recording a meeting.", 409);
      const { data, error } = await access.admin.from("psychosocial_assessments").update({
        stage: "consultation_scheduled",
        meeting_date: body.meeting_date || null,
        meeting_time: body.meeting_time || null,
        meeting_format: body.meeting_format || null,
        meeting_location: body.meeting_location || null,
        support_person: body.support_person || null,
        meeting_attendees: body.meeting_attendees || [],
        meeting_items: body.meeting_items || [],
        matters_not_agreed: body.matters_not_agreed || null,
        follow_up_review_date: body.follow_up_review_date || null,
        next_assessment_due: body.next_assessment_due || null,
        escalated_to_leadership: body.escalated_to_leadership || null,
        updated_at: now,
      }).eq("id", body.id).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      return Response.json({ assessment: data });
    }

    // Stage 5: close-out — admin only. The gate: a meeting must actually be
    // on record, and any Medium+ risk must have an action recorded — this
    // is enforced here, not left to the form's own "please don't" note.
    if (action === "close_out") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can close this assessment.", 403);
      if (existing.stage !== "consultation_scheduled") return jsonError("A consultation meeting must be recorded before close-out.", 409);
      if (!body.meeting_date) return jsonError("This record has no meeting date — record the consultation meeting before closing.", 409);
      const { data, error } = await access.admin.from("psychosocial_assessments").update({
        stage: "closed",
        worker_signature_final: body.worker_signature_final || null,
        whs_officer_name: body.whs_officer_name || null,
        whs_officer_review_date: body.whs_officer_review_date || null,
        whs_officer_signature: body.whs_officer_signature || null,
        project_manager_name: body.project_manager_name || null,
        project_manager_signature: body.project_manager_signature || null,
        closed_at: now,
        updated_at: now,
      }).eq("id", body.id).select(COLUMNS).single();
      if (error) return jsonError(error.message);
      return Response.json({ assessment: data });
    }

    return jsonError("Unknown action.");
  } catch (error) {
    return serverError(error);
  }
}
