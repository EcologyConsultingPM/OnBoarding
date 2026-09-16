import crypto from "node:crypto";
import { requireSession, serverError } from "../../../lib/serverAuth";
import { PRIMARY_ADMIN_EMAILS, requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The API, rather than the browser, is the authoritative workflow and risk engine.
const HAZARD_CATEGORIES = new Set([
  "High job demands", "Low job control", "Poor support (supervisor / peer)", "Low role clarity",
  "Poor organisational change management", "Low reward and recognition", "Poor organisational justice",
  "Traumatic events or material", "Remote / isolated work", "Poor physical environment",
  "Violence and aggression", "Bullying", "Harassment (including sexual harassment)",
  "Conflict or poor workplace relationships",
]);
const ASSESSMENT_METHODS = new Set([
  "Worker self-assessment", "Focus group / consultation", "Incident review", "Worksite observation", "Meeting / interview",
]);
const EXPOSURE_LEVELS = new Set(["Rare", "Occasional", "Frequent", "Continuous"]);
const CONTROL_EFFECTIVENESS = new Set(["Effective", "Partially effective", "Ineffective", "Not in place"]);
const RISK_VALIDATION_OPTIONS = new Set(["Confirmed as submitted", "Amended — raised", "Amended — lowered"]);
const RESIDUAL_RISK_OPTIONS = new Set(["Low", "Medium", "High", "Extreme"]);
const ACTION_STATUS_OPTIONS = new Set(["Not started", "In progress", "Completed"]);
const MEETING_FORMATS = new Set(["In person", "Video call", "Telephone"]);
const ESCALATION_OPTIONS = new Set(["Not required", "Escalated to leadership", "External support / referral"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A worker never receives internal identifiers or the raw admin projection.
const WORKER_COLUMNS = [
  "id", "stage", "position", "assessment_date", "workplace_location", "scope",
  "assessment_methods", "hazard_categories", "category_notes", "hazard_register", "additional_notes",
  "discuss_in_person", "submitted_to", "submitted_at", "worker_declaration_signature",
  "worker_declaration_confirmed", "is_critical", "root_cause_analysis", "corrective_action_plan",
  "risk_ratings_validated", "controls_reviewed_finding", "additional_actions_identified",
  "individual_action_plan_required", "highest_residual_risk", "reviewed_at", "returned_to_worker_at",
  "worker_acknowledgement_signature", "worker_acknowledgement_confirmed", "worker_response_before_meeting",
  "worker_acknowledged_at", "meeting_date", "meeting_time", "meeting_format", "meeting_location",
  "support_person", "meeting_attendees", "meeting_outcomes", "matters_not_agreed", "follow_up_review_date",
  "next_assessment_due", "escalation_status", "escalation_details", "meeting_completed_at",
  "worker_signature_final", "worker_final_signature_confirmed", "worker_final_signed_at", "whs_officer_name",
  "whs_officer_review_date", "project_manager_name", "closed_at", "created_at", "updated_at",
].join(", ");
const ADMIN_COLUMNS = [
  WORKER_COLUMNS, "worker_id", "submission_key", "whs_officer_id", "returned_by", "return_method",
  "whs_officer_signature", "project_manager_signature",
].join(", ");

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function safeText(value, max = 2000) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function requiredText(value, label, max = 2000) {
  const text = safeText(value, max);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function validDate(value, label, required = false) {
  if (!value && !required) return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return value;
}

function uniqueAllowed(raw, allowed, label, max = 20) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > max) throw new Error(`Too many ${label}.`);
  const values = [];
  for (const value of raw) {
    if (typeof value !== "string" || !allowed.has(value)) throw new Error(`Invalid ${label}.`);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function deriveRisk(likelihood, consequence) {
  const l = Number(likelihood);
  const c = Number(consequence);
  if (!Number.isInteger(l) || l < 1 || l > 5 || !Number.isInteger(c) || c < 1 || c > 4) {
    throw new Error("Each complete activity needs a valid likelihood and consequence.");
  }
  const risk_score = l * c;
  const risk_rating = risk_score >= 15 ? "Extreme" : risk_score >= 8 ? "High" : risk_score >= 4 ? "Medium" : "Low";
  return { likelihood: l, consequence: c, risk_score, risk_rating, rating_band: risk_rating.toLowerCase() };
}

function normaliseRegister(raw, complete) {
  if (!Array.isArray(raw) || raw.length > 5) throw new Error("Provide no more than five work activities.");
  if (complete && (raw.length < 3 || raw.length > 5)) throw new Error("Submit three to five complete work activities.");
  return raw.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Each activity must be an object.");
    const activity = safeText(row.activity, 500);
    const hazard_category = safeText(row.hazard_category, 160);
    const hazard_detail = safeText(row.hazard_detail, 2000);
    const exposure = safeText(row.exposure, 40);
    const controls = safeText(row.controls, 2000);
    const control_effectiveness = safeText(row.control_effectiveness ?? row.effectiveness, 40);
    const likelihood = row.likelihood === "" || row.likelihood == null ? "" : String(row.likelihood);
    const consequence = row.consequence === "" || row.consequence == null ? "" : String(row.consequence);
    const populated = activity || hazard_category || hazard_detail || exposure || controls || control_effectiveness || likelihood || consequence;
    if (hazard_category && !HAZARD_CATEGORIES.has(hazard_category)) throw new Error("An activity has an invalid hazard category.");
    if (exposure && !EXPOSURE_LEVELS.has(exposure)) throw new Error("An activity has an invalid exposure level.");
    if (control_effectiveness && !CONTROL_EFFECTIVENESS.has(control_effectiveness)) throw new Error("An activity has an invalid control effectiveness value.");
    if (complete && (!activity || !hazard_category || !hazard_detail || !exposure || !controls || !control_effectiveness || !likelihood || !consequence)) {
      throw new Error(`Activity ${index + 1} is incomplete. Include task, category, hazard, exposure, controls, effectiveness, likelihood and consequence.`);
    }
    if (!complete && !populated) return { activity: "", hazard_category: "", hazard_detail: "", exposure: "", controls: "", control_effectiveness: "", likelihood: "", consequence: "", risk_score: null, risk_rating: null, rating_band: null };
    let derived = { risk_score: null, risk_rating: null, rating_band: null };
    if (likelihood || consequence) {
      if (!likelihood || !consequence) {
        if (complete) throw new Error(`Activity ${index + 1} needs both likelihood and consequence.`);
      } else {
        derived = deriveRisk(likelihood, consequence);
      }
    }
    return { activity, hazard_category, hazard_detail, exposure, controls, control_effectiveness, likelihood, consequence, ...derived };
  });
}

function normaliseCategoryNotes(raw, categories, required) {
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const notes = {};
  for (const [category, value] of Object.entries(values)) {
    if (!HAZARD_CATEGORIES.has(category) || !categories.includes(category)) throw new Error("Category notes include an invalid category.");
    const note = safeText(value, 2000);
    if (note) notes[category] = note;
  }
  if (required) for (const category of categories) if (!notes[category]) throw new Error(`Add a category note for ${category}.`);
  return notes;
}

function workerAssessment(body, complete) {
  const hazard_categories = uniqueAllowed(body.hazard_categories, HAZARD_CATEGORIES, "hazard categories", HAZARD_CATEGORIES.size);
  const hazard_register = normaliseRegister(body.hazard_register, complete);
  const assessment_methods = uniqueAllowed(body.assessment_methods, ASSESSMENT_METHODS, "assessment methods", ASSESSMENT_METHODS.size);
  const worker_declaration_signature = safeText(body.worker_declaration_signature, 200);
  if (complete) {
    if (!hazard_categories.length) throw new Error("Select the psychosocial hazard categories present.");
    if (!assessment_methods.length) throw new Error("Select at least one assessment method.");
    if (!hazard_register.every((row) => hazard_categories.includes(row.hazard_category))) throw new Error("Each activity category must be selected in the category section.");
    if (!worker_declaration_signature || body.worker_declaration_confirmed !== true) throw new Error("Confirm the worker declaration and provide your name before submitting.");
  }
  return {
    position: complete ? requiredText(body.position, "Position / role", 200) : safeText(body.position, 200) || null,
    assessment_date: complete ? validDate(body.assessment_date, "Assessment date", true) : validDate(body.assessment_date, "Assessment date"),
    workplace_location: complete ? requiredText(body.workplace_location, "Workplace / location", 500) : safeText(body.workplace_location, 500) || null,
    scope: complete ? requiredText(body.scope, "Assessment scope", 1000) : safeText(body.scope, 1000) || null,
    assessment_methods,
    hazard_categories,
    category_notes: normaliseCategoryNotes(body.category_notes, hazard_categories, complete),
    hazard_register,
    additional_notes: safeText(body.additional_notes, 3000) || null,
    discuss_in_person: body.discuss_in_person === true,
    worker_declaration_signature: worker_declaration_signature || null,
    worker_declaration_confirmed: body.worker_declaration_confirmed === true,
  };
}

function mediumPlusIndexes(register) {
  return (register || []).reduce((indexes, row, index) => {
    if (["Medium", "High", "Extreme"].includes(row?.risk_rating)) indexes.push(index);
    return indexes;
  }, []);
}

function correctiveActions(raw, register) {
  const required = mediumPlusIndexes(register);
  if (!required.length) return [];
  if (!Array.isArray(raw) || raw.length !== required.length) throw new Error("A corrective action is required for every Medium, High or Extreme activity.");
  const normalised = raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Each corrective action must be complete.");
    const activity_index = Number(item.activity_index);
    const status = requiredText(item.status, "Corrective action status", 40);
    if (!required.includes(activity_index) || !ACTION_STATUS_OPTIONS.has(status)) throw new Error("A corrective action has an invalid activity or status.");
    return {
      activity_index,
      activity: register[activity_index].activity,
      risk_rating: register[activity_index].risk_rating,
      action: requiredText(item.action, "Corrective action", 2000),
      owner: requiredText(item.owner, "Corrective action owner", 200),
      due_date: validDate(item.due_date, "Corrective action due date", true),
      status,
    };
  });
  const covered = new Set(normalised.map((item) => item.activity_index));
  if (covered.size !== normalised.length || required.some((index) => !covered.has(index))) throw new Error("A corrective action is required for every Medium, High or Extreme activity.");
  return normalised;
}

function reviewPayload(body, register, userId, now) {
  const risk_ratings_validated = requiredText(body.risk_ratings_validated, "Risk rating validation", 80);
  const highest_residual_risk = requiredText(body.highest_residual_risk, "Highest residual risk", 30);
  const individual_action_plan_required = safeText(body.individual_action_plan_required, 30);
  if (!RISK_VALIDATION_OPTIONS.has(risk_ratings_validated) || !RESIDUAL_RISK_OPTIONS.has(highest_residual_risk) || (individual_action_plan_required && !["Yes", "No"].includes(individual_action_plan_required))) {
    throw new Error("Select valid WHS review outcomes.");
  }
  return {
    stage: "whs_review", whs_officer_id: userId,
    root_cause_analysis: requiredText(body.root_cause_analysis, "Root cause analysis", 4000),
    corrective_action_plan: correctiveActions(body.corrective_action_plan, register),
    risk_ratings_validated,
    controls_reviewed_finding: requiredText(body.controls_reviewed_finding, "Controls review finding", 4000),
    additional_actions_identified: safeText(body.additional_actions_identified, 4000) || null,
    individual_action_plan_required: individual_action_plan_required || null,
    highest_residual_risk, reviewed_at: now, updated_at: now,
  };
}

function meetingPayload(body, now) {
  const meeting_format = requiredText(body.meeting_format, "Meeting format", 40);
  const escalation_status = requiredText(body.escalation_status, "Escalation outcome", 60);
  const meeting_attendees = Array.isArray(body.meeting_attendees) ? body.meeting_attendees.map((value) => safeText(value, 200)).filter(Boolean) : [];
  const escalation_details = safeText(body.escalation_details, 3000);
  if (!MEETING_FORMATS.has(meeting_format) || !ESCALATION_OPTIONS.has(escalation_status)) throw new Error("Select valid meeting and escalation outcomes.");
  if (!meeting_attendees.length || meeting_attendees.length > 20) throw new Error("Record the meeting attendees.");
  if (escalation_status !== "Not required" && !escalation_details) throw new Error("Explain the escalation or referral outcome.");
  return {
    stage: "consultation_completed",
    meeting_date: validDate(body.meeting_date, "Meeting date", true),
    meeting_time: safeText(body.meeting_time, 10) || null,
    meeting_format,
    meeting_location: requiredText(body.meeting_location, "Meeting location / connection", 500),
    support_person: requiredText(body.support_person, "Support person arrangement", 500),
    meeting_attendees: [...new Set(meeting_attendees)],
    meeting_outcomes: requiredText(body.meeting_outcomes, "Meeting outcomes", 5000),
    matters_not_agreed: safeText(body.matters_not_agreed, 3000) || null,
    follow_up_review_date: validDate(body.follow_up_review_date, "Follow-up review date"),
    next_assessment_due: validDate(body.next_assessment_due, "Next assessment due"),
    escalation_status, escalation_details: escalation_details || null, meeting_completed_at: now, updated_at: now,
  };
}

function hasCompleteMeeting(record) {
  return Boolean(record.meeting_date && record.meeting_format && record.meeting_location && record.support_person
    && Array.isArray(record.meeting_attendees) && record.meeting_attendees.length && record.meeting_outcomes && record.escalation_status);
}

function hasCorrectiveActions(record) {
  const required = mediumPlusIndexes(record.hazard_register);
  const covered = new Set((record.corrective_action_plan || []).map((action) => Number(action?.activity_index)));
  return required.every((index) => covered.has(index));
}

function submissionKey(workerId, payload) {
  return crypto.createHash("sha256").update(JSON.stringify({
    workerId, assessment_date: payload.assessment_date, position: payload.position, workplace_location: payload.workplace_location,
    scope: payload.scope, assessment_methods: payload.assessment_methods, hazard_categories: payload.hazard_categories,
    category_notes: payload.category_notes, hazard_register: payload.hazard_register,
  })).digest("hex");
}

function isCritical(register) {
  return (register || []).some((row) => ["High", "Extreme"].includes(row.risk_rating));
}

function visibleRecord(record, isAdmin) {
  if (isAdmin) return record;
  const allowed = new Set(WORKER_COLUMNS.split(", ").map((column) => column.trim()));
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowed.has(key)));
}

async function updateRecord(admin, id, patch) {
  const { data, error } = await admin.from("psychosocial_assessments").update(patch).eq("id", id).select(ADMIN_COLUMNS).single();
  if (error) {
    console.error("Psychosocial assessment update failed:", error.message);
    return null;
  }
  return data;
}

async function notificationRecipients(admin) {
  const { data: adminRows } = await admin.from("admin_emails").select("email");
  const emails = new Set([...PRIMARY_ADMIN_EMAILS, ...(adminRows || []).map((row) => safeText(row.email, 320).toLowerCase()).filter(Boolean)]);
  const { data: usersData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (usersData?.users || []).filter((user) => emails.has(safeText(user.email, 320).toLowerCase())).map((user) => user.id).filter(Boolean);
}

async function notifyWhsOfficers(admin, assessment) {
  try {
    const recipients = await notificationRecipients(admin);
    if (!recipients.length) return;
    const critical = assessment.is_critical === true;
    await admin.from("portal_events").insert(recipients.map((recipient_id) => ({
      recipient_id,
      event_type: critical ? "psychosocial_critical_risk" : "psychosocial_review_required",
      severity: critical ? "critical" : "action_required",
      title: critical ? "Critical Psychosocial Risk — immediate review required" : "Psychosocial Self Risk Assessment submitted",
      body: critical ? "A submitted assessment includes a High or Extreme psychosocial risk. Review immediately." : "A worker has submitted a psychosocial self-risk assessment for review.",
      href: "/?portal=staff&area=forms", source_table: "psychosocial_assessments", source_id: assessment.id,
    })));
  } catch (error) {
    // Submission remains authoritative even when the non-critical notification fails.
    console.warn("Psychosocial WHS notification could not be created:", error?.message);
  }
}

async function notifyWorkerReturned(admin, assessment) {
  try {
    await admin.from("portal_events").insert({
      recipient_id: assessment.worker_id, event_type: "psychosocial_findings_returned", severity: "action_required",
      title: "Your psychosocial assessment findings are ready",
      body: "The WHS Officer has completed a review. Please read the findings, acknowledge them, and take part in the consultation meeting.",
      href: "/?portal=staff&area=forms", source_table: "psychosocial_assessments", source_id: assessment.id,
    });
  } catch (error) {
    console.warn("Psychosocial worker notification could not be created:", error?.message);
  }
}

async function requestBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new Error("Submit a valid assessment request.");
  }
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.forms");
    if (denied) return denied;
    const id = new URL(request.url).searchParams.get("id");
    const columns = access.isAdmin ? ADMIN_COLUMNS : WORKER_COLUMNS;
    if (id) {
      if (!UUID.test(id)) return jsonError("Invalid assessment identifier.");
      let query = access.admin.from("psychosocial_assessments").select(columns).eq("id", id);
      if (!access.isAdmin) query = query.eq("worker_id", access.user.id);
      const { data, error } = await query.maybeSingle();
      if (error) {
        console.error("Psychosocial assessment lookup failed:", error.message);
        return jsonError("Unable to load the assessment.", 500);
      }
      if (!data) return jsonError("Assessment not found.", 404);
      return Response.json({ assessment: visibleRecord(data, access.isAdmin) });
    }
    let query = access.admin.from("psychosocial_assessments").select(columns).order("created_at", { ascending: false });
    if (!access.isAdmin) query = query.eq("worker_id", access.user.id);
    const { data, error } = await query;
    if (error) {
      console.error("Psychosocial assessment list failed:", error.message);
      return jsonError("Unable to load assessments.", 500);
    }
    return Response.json({ assessments: (data || []).map((record) => visibleRecord(record, access.isAdmin)) });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.forms");
    if (denied) return denied;
    const body = await requestBody(request);
    const action = safeText(body.action, 60) || (body.submit === true ? "submit" : "save_draft");
    const now = new Date().toISOString();

    // Stage 1: own worker assessment only; submissions are idempotent by worker/key.
    if (!body.id) {
      if (!["save_draft", "submit"].includes(action)) return jsonError("Create a draft or submit a worker assessment first.", 409);
      const complete = action === "submit";
      const payload = workerAssessment(body, complete);
      const submission_key = complete ? submissionKey(access.user.id, payload) : null;
      const insert = {
        worker_id: access.user.id, ...payload, stage: complete ? "submitted" : "draft", is_critical: isCritical(payload.hazard_register),
        submitted_to: complete ? "WHS Officer" : null, submitted_at: complete ? now : null, submission_key, created_at: now, updated_at: now,
      };
      const { data, error } = await access.admin.from("psychosocial_assessments").insert(insert).select(ADMIN_COLUMNS).single();
      if (error) {
        if (complete && (error.code === "23505" || String(error.message || "").includes("psychosocial_assessments_worker_submission_key_uidx"))) {
          const { data: duplicate } = await access.admin.from("psychosocial_assessments").select(ADMIN_COLUMNS).eq("worker_id", access.user.id).eq("submission_key", submission_key).maybeSingle();
          if (duplicate) return Response.json({ assessment: visibleRecord(duplicate, access.isAdmin), duplicate: true });
        }
        console.error("Psychosocial assessment insert failed:", error.message);
        return jsonError("Unable to save the assessment.", 500);
      }
      if (complete) await notifyWhsOfficers(access.admin, data);
      return Response.json({ assessment: visibleRecord(data, access.isAdmin) }, { status: 201 });
    }

    if (typeof body.id !== "string" || !UUID.test(body.id)) return jsonError("Invalid assessment identifier.");
    const { data: existing, error: findError } = await access.admin.from("psychosocial_assessments").select(ADMIN_COLUMNS).eq("id", body.id).maybeSingle();
    if (findError) {
      console.error("Psychosocial assessment state lookup failed:", findError.message);
      return jsonError("Unable to load the assessment.", 500);
    }
    // Do not disclose another worker's register record.
    if (!existing || (!access.isAdmin && existing.worker_id !== access.user.id)) return jsonError("Assessment not found.", 404);

    if (["save_draft", "submit"].includes(action)) {
      if (existing.worker_id !== access.user.id) return jsonError("Only the assessed worker can update this assessment.", 403);
      if (action === "submit" && existing.stage === "submitted") return Response.json({ assessment: visibleRecord(existing, access.isAdmin), duplicate: true });
      if (existing.stage !== "draft") return jsonError("This assessment can no longer be edited as a draft.", 409);
      const complete = action === "submit";
      const payload = workerAssessment(body, complete);
      const patch = { ...payload, is_critical: isCritical(payload.hazard_register), updated_at: now };
      if (complete) Object.assign(patch, { stage: "submitted", submitted_to: "WHS Officer", submitted_at: now, submission_key: submissionKey(access.user.id, payload) });
      const data = await updateRecord(access.admin, existing.id, patch);
      if (!data) return jsonError("Unable to save the assessment.", 500);
      if (complete) await notifyWhsOfficers(access.admin, data);
      return Response.json({ assessment: visibleRecord(data, access.isAdmin) });
    }

    // Stage 2: review uses persisted server-derived risks to require actions.
    if (action === "whs_review") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can complete this review.", 403);
      if (existing.stage === "whs_review") return Response.json({ assessment: visibleRecord(existing, true), duplicate: true });
      if (existing.stage !== "submitted") return jsonError("Only a submitted assessment can be reviewed.", 409);
      const data = await updateRecord(access.admin, existing.id, reviewPayload(body, existing.hazard_register, access.user.id, now));
      return data ? Response.json({ assessment: visibleRecord(data, true) }) : jsonError("Unable to save the assessment.", 500);
    }

    // Stage 3: review return and acknowledgement have distinct persisted states.
    if (action === "return_to_worker") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can return findings to the worker.", 403);
      if (existing.stage === "returned_to_worker") return Response.json({ assessment: visibleRecord(existing, true), duplicate: true });
      if (existing.stage !== "whs_review") return jsonError("Complete the WHS review before returning findings to the worker.", 409);
      const data = await updateRecord(access.admin, existing.id, { stage: "returned_to_worker", returned_to_worker_at: now, returned_by: safeText(access.user.email, 320) || "WHS Officer", return_method: "Portal notification", updated_at: now });
      if (!data) return jsonError("Unable to save the assessment.", 500);
      await notifyWorkerReturned(access.admin, data);
      return Response.json({ assessment: visibleRecord(data, true) });
    }

    if (action === "worker_acknowledge") {
      if (existing.worker_id !== access.user.id) return jsonError("Only the assessed worker can acknowledge findings.", 403);
      if (existing.stage === "worker_acknowledged") return Response.json({ assessment: visibleRecord(existing, false), duplicate: true });
      if (existing.stage !== "returned_to_worker") return jsonError("Findings are not awaiting worker acknowledgement.", 409);
      if (body.worker_acknowledgement_confirmed !== true) return jsonError("Confirm that you have read the findings before continuing.");
      const data = await updateRecord(access.admin, existing.id, {
        stage: "worker_acknowledged", worker_acknowledgement_signature: requiredText(body.worker_acknowledgement_signature, "Acknowledgement signature", 200),
        worker_acknowledgement_confirmed: true, worker_response_before_meeting: safeText(body.worker_response_before_meeting, 3000) || null,
        worker_acknowledged_at: now, updated_at: now,
      });
      return data ? Response.json({ assessment: visibleRecord(data, false) }) : jsonError("Unable to save the assessment.", 500);
    }

    // Stage 4 cannot be entered until acknowledgement is persisted—removing the old review dead end.
    if (action === "record_meeting") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can record the consultation meeting.", 403);
      if (existing.stage === "consultation_completed") return Response.json({ assessment: visibleRecord(existing, true), duplicate: true });
      if (existing.stage !== "worker_acknowledged" || !existing.worker_acknowledgement_confirmed || !existing.worker_acknowledgement_signature) return jsonError("Worker acknowledgement must be recorded before the consultation meeting.", 409);
      const data = await updateRecord(access.admin, existing.id, meetingPayload(body, now));
      return data ? Response.json({ assessment: visibleRecord(data, true) }) : jsonError("Unable to save the assessment.", 500);
    }

    // The final worker signature is a separate worker-scoped action.
    if (action === "worker_final_sign") {
      if (existing.worker_id !== access.user.id) return jsonError("Only the assessed worker can provide the final signature.", 403);
      if (existing.worker_final_signature_confirmed) return Response.json({ assessment: visibleRecord(existing, false), duplicate: true });
      if (existing.stage !== "consultation_completed" || !hasCompleteMeeting(existing)) return jsonError("A complete consultation meeting is required before final signing.", 409);
      if (body.worker_final_signature_confirmed !== true) return jsonError("Confirm the final declaration before signing.");
      const data = await updateRecord(access.admin, existing.id, { worker_signature_final: requiredText(body.worker_signature_final, "Final worker signature", 200), worker_final_signature_confirmed: true, worker_final_signed_at: now, updated_at: now });
      return data ? Response.json({ assessment: visibleRecord(data, false) }) : jsonError("Unable to save the assessment.", 500);
    }

    // Stage 5 gates against persisted data only; request fields cannot bypass them.
    if (action === "close_out") {
      if (!access.isAdmin) return jsonError("Only the WHS Officer can close this assessment.", 403);
      if (existing.stage === "closed") return Response.json({ assessment: visibleRecord(existing, true), duplicate: true });
      if (existing.stage !== "consultation_completed" || !hasCompleteMeeting(existing)) return jsonError("A complete consultation meeting must be persisted before close-out.", 409);
      if (!existing.worker_acknowledgement_confirmed || !existing.worker_acknowledgement_signature || !existing.worker_final_signature_confirmed || !existing.worker_signature_final) return jsonError("The worker acknowledgement and final signature must be persisted before close-out.", 409);
      if (!hasCorrectiveActions(existing)) return jsonError("Corrective actions for all Medium, High or Extreme activities must be persisted before close-out.", 409);
      const data = await updateRecord(access.admin, existing.id, {
        stage: "closed", whs_officer_name: requiredText(body.whs_officer_name, "WHS Officer name", 200), whs_officer_review_date: validDate(body.whs_officer_review_date, "WHS Officer review date", true),
        whs_officer_signature: requiredText(body.whs_officer_signature, "WHS Officer signature", 200), project_manager_name: requiredText(body.project_manager_name, "Project Manager name", 200),
        project_manager_signature: requiredText(body.project_manager_signature, "Project Manager signature", 200), closed_at: now, updated_at: now,
      });
      return data ? Response.json({ assessment: visibleRecord(data, true) }) : jsonError("Unable to save the assessment.", 500);
    }

    return jsonError("Unknown assessment action.");
  } catch (error) {
    // Validation is clear enough to correct a field; provider/configuration detail remains server-only.
    if (error instanceof Error && !/Supabase|configuration/i.test(error.message)) return jsonError(error.message);
    return serverError(error);
  }
}
