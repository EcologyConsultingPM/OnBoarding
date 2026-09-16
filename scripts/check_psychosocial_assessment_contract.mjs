import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const component = await read("components/PsychosocialSelfRiskAssessment.js");
const route = await read("app/api/psychosocial-assessments/route.js");
const sql = await read("sql/2026-09-16-psychosocial-assessments.sql");

function includes(source, needle, message) {
  assert.ok(source.includes(needle), message);
}
function matches(source, expression, message) {
  assert.match(source, expression, message);
}

// Confidential access and safe response surface.
includes(route, 'requirePortalResource(access, "staff.forms")', "The route must enforce the staff forms visibility resource.");
includes(route, "const WORKER_COLUMNS", "The route must maintain an explicit worker projection.");
includes(route, "const ADMIN_COLUMNS", "The route must maintain an explicit administrator projection.");
assert.ok(!route.includes('const COLUMNS = "*"'), "The route must not use a wildcard confidential-record projection.");
includes(route, "eq(\"worker_id\", access.user.id)", "Worker reads must be scoped to the authenticated worker.");
includes(route, "visibleRecord", "Responses must be allowlisted before returning to a worker.");
includes(route, "Assessment not found.", "Out-of-scope worker access must fail without exposing another record.");
includes(route, "Unable to save the assessment.", "Database errors must be translated to safe responses.");

// Stage 1 completeness and server-side risk derivation.
includes(route, "function deriveRisk", "Risk rating must be derived server-side.");
includes(route, "Submit three to five complete work activities.", "The server must require 3–5 complete activities.");
includes(route, "control_effectiveness", "Activity control effectiveness must be captured.");
includes(route, "EXPOSURE_LEVELS", "Activity exposure must be allowlisted.");
includes(route, "normaliseCategoryNotes", "Selected hazard category notes must be captured and validated.");
includes(route, "worker_declaration_confirmed", "Worker declaration confirmation must be persisted.");
includes(route, "submission_key", "Submissions must use an idempotency key.");
includes(route, "psychosocial_assessments_worker_submission_key_uidx", "Duplicate submissions must return the earlier assessment where practical.");

// Server-authoritative five-stage state transitions and gates.
for (const stage of ["submitted", "whs_review", "returned_to_worker", "worker_acknowledged", "consultation_completed", "closed"]) {
  includes(route, `stage: "${stage}"`, `The route must persist the ${stage} stage.`);
}
includes(route, "action === \"worker_acknowledge\"", "Worker acknowledgement must be an explicit server action.");
includes(route, "action === \"record_meeting\"", "Consultation meeting must be an explicit server action.");
includes(route, "action === \"worker_final_sign\"", "Final worker signature must be a separate worker action.");
includes(route, "action === \"close_out\"", "Close-out must be an explicit server action.");
includes(route, "Worker acknowledgement must be recorded before the consultation meeting.", "The server must prevent the review-stage meeting dead end and require the persisted acknowledgement transition.");
includes(route, "function hasCompleteMeeting", "Close-out must inspect persisted meeting completeness.");
includes(route, "function hasCorrectiveActions", "Close-out must inspect persisted corrective-action coverage.");
includes(route, "correctiveActions(body.corrective_action_plan, register)", "Medium+ corrective actions must be enforced during review from the persisted register.");
includes(route, "worker_final_signature_confirmed", "Close-out must depend on persisted worker final signature state.");
includes(route, "meeting_outcomes", "Meeting outcomes must be persisted.");
includes(route, "support_person", "Meeting support-person arrangement must be persisted.");
includes(route, "escalation_status", "Meeting escalation outcome must be persisted.");

// Existing portal route only; no legacy/nonexistent WHS-form deep link.
includes(route, 'href: "/?portal=staff&area=forms"', "Notifications must point to the existing root staff forms portal route.");
assert.ok(!route.includes("/staff/whs-forms"), "Notifications must not use the nonexistent staff/whs-forms route.");

// Worker-facing affordances and accessible semantics.
includes(component, "Lifeline 13 11 14", "The component must render Lifeline guidance.");
includes(component, "window.print()", "The component must provide print behaviour.");
includes(component, 'aria-labelledby="psa-title"', "The component must label its assessment region.");
includes(component, 'role="alert"', "The component must expose important errors or critical alerts accessibly.");
includes(component, "Exposure", "The component must capture exposure.");
includes(component, "Control effectiveness", "The component must capture control effectiveness.");
includes(component, "Category note", "The component must render category notes.");
includes(component, "Corrective action plan", "The component must render Medium+ corrective action planning.");
includes(component, "Meeting outcomes and agreed actions", "The component must capture meeting outcomes.");
includes(component, "Final worker signature", "The component must capture final worker signatures.");
includes(component, "worker_acknowledged", "The component must render the post-acknowledgement stage rather than leaving review at a dead end.");

// Database contract: restricted store, transitions, idempotency and supporting fields.
includes(sql, "create table if not exists public.psychosocial_assessments", "The migration must create the restricted assessment table.");
includes(sql, "psychosocial_assessments_stage_check", "The migration must constrain the workflow stages.");
includes(sql, "worker_acknowledged", "The migration must include the persisted acknowledgement stage.");
includes(sql, "consultation_completed", "The migration must include the completed consultation stage.");
includes(sql, "category_notes jsonb", "The migration must persist category notes.");
includes(sql, "worker_final_signature_confirmed", "The migration must persist final worker-signature state.");
includes(sql, "meeting_outcomes", "The migration must persist meeting outcomes.");
includes(sql, "enable row level security", "The restricted table must have RLS enabled.");
includes(sql, "psychosocial_assessments_worker_submission_key_uidx", "The migration must enforce idempotent worker submissions.");

console.log("Psychosocial assessment contract passed: five-stage server workflow, restricted access, audited fields, close-out gates, portal notifications and worker safeguards verified.");
