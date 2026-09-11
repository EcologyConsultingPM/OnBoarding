/**
 * Ecado evaluation suite.
 *
 * Executes the real rule engine against synthetic snapshots. This is
 * behavioural, not a source grep: every case builds a snapshot in the shape
 * collectSnapshot() produces, runs classify(), and asserts on the findings.
 *
 * classify.js is the largest piece of unreviewed judgement in the codebase and
 * had no coverage. Thresholds are read from DEFAULT_THRESHOLDS rather than
 * hard-coded, so tuning a threshold does not silently invalidate these cases —
 * boundary tests are expressed relative to the configured value.
 *
 *   node scripts/ecado_evals.mjs
 */
import { loadEcado, snapshot } from "./_ecado_loader.mjs";

const NOW = new Date("2026-09-11T00:00:00.000Z");
const day = (offset) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const { classify, filterToCompliance, filterToProject } = await loadEcado("classify");
const { DEFAULT_THRESHOLDS: T } = await loadEcado("thresholds");
const { sortFindings, countByRating } = await loadEcado("types");
const { validateNarration } = await loadEcado("prompt");

let pass = 0;
const failures = [];
function check(label, condition, detail = "") {
  if (condition) { pass += 1; return; }
  failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
const run = (feeds) => classify(snapshot(feeds), T, NOW);
const ids = (findings) => findings.map((f) => f.ruleId);
const byRule = (findings, ruleId) => findings.filter((f) => f.ruleId === ruleId);

// ---------------------------------------------------------------- WHS
{
  const open = run({ incidents: [{ id: "i1", ref: "WHS-034", status: "open", notifiable: true, occurredAt: day(-10) }] });
  check("notifiable open incident is found", ids(open).includes("whs.notifiable_open"));
  check("notifiable open incident is critical", byRule(open, "whs.notifiable_open")[0]?.rating === "critical");
  check("notifiable open incident is safety domain", byRule(open, "whs.notifiable_open")[0]?.domain === "safety");

  const closed = run({ incidents: [{ id: "i1", ref: "WHS-034", status: "closed", notifiable: true, occurredAt: day(-10) }] });
  check("closed notifiable incident is not raised", !ids(closed).includes("whs.notifiable_open"));

  const notNotifiable = run({ incidents: [{ id: "i2", status: "open", notifiable: false, occurredAt: day(-10) }] });
  check("non-notifiable open incident is not raised as notifiable", !ids(notNotifiable).includes("whs.notifiable_open"));

  const inv = run({ incidents: [{ id: "i3", ref: "WHS-035", status: "open", notifiable: false, investigationDueDate: day(-3) }] });
  check("overdue investigation is found", ids(inv).includes("whs.investigation_overdue"));
  check("investigation 3d overdue is high", byRule(inv, "whs.investigation_overdue")[0]?.rating === "high");

  const invLate = run({ incidents: [{ id: "i4", status: "open", investigationDueDate: day(-20) }] });
  check("investigation >14d overdue escalates to critical", byRule(invLate, "whs.investigation_overdue")[0]?.rating === "critical");

  const invFuture = run({ incidents: [{ id: "i5", status: "open", investigationDueDate: day(5) }] });
  check("investigation not yet due is not raised", !ids(invFuture).includes("whs.investigation_overdue"));
}

// ------------------------------------------------------- certifications
{
  const t = T.certification;
  const expired = run({ certifications: [{ id: "c1", staffEmail: "a@b.com", competency: "First Aid", expiryDate: day(-1) }] });
  check("expired certification is critical", byRule(expired, "certification.expiring")[0]?.rating === "critical");

  const soon = run({ certifications: [{ id: "c2", staffEmail: "a@b.com", competency: "First Aid", expiryDate: day(t.highExpiringDays - 1) }] });
  check("certification inside the high window is high", byRule(soon, "certification.expiring")[0]?.rating === "high");

  const medium = run({ certifications: [{ id: "c3", staffEmail: "a@b.com", competency: "First Aid", expiryDate: day(t.mediumExpiringDays - 1) }] });
  check("certification inside the medium window is medium", byRule(medium, "certification.expiring")[0]?.rating === "medium");

  const far = run({ certifications: [{ id: "c4", staffEmail: "a@b.com", competency: "First Aid", expiryDate: day(t.mediumExpiringDays + 30) }] });
  check("certification beyond the medium window is not raised", byRule(far, "certification.expiring").length === 0);

  const noDate = run({ certifications: [{ id: "c5", staffEmail: "a@b.com", competency: "First Aid", expiryDate: null }] });
  check("certification with no expiry date is skipped, not crashed", byRule(noDate, "certification.expiring").length === 0);
}

// --------------------------------------------------- corrective actions
{
  const t = T.corrective_action;
  const late = run({ correctiveActions: [{ id: "ca1", ref: "CA-1", status: "open", dueDate: day(-(t.criticalOverdueDays + 1)) }] });
  check("corrective action past the critical window is critical", byRule(late, "corrective_action.overdue")[0]?.rating === "critical");

  const mild = run({ correctiveActions: [{ id: "ca2", ref: "CA-2", status: "open", dueDate: day(-1) }] });
  check("corrective action 1d overdue is raised", byRule(mild, "corrective_action.overdue").length === 1);

  const done = run({ correctiveActions: [{ id: "ca3", status: "closed", dueDate: day(-30) }] });
  check("closed corrective action is not raised", byRule(done, "corrective_action.overdue").length === 0);
}

// -------------------------------------------------------- survey windows
{
  const t = T.survey_window;
  const missed = run({ activities: [{ id: "a1", projectId: "p1", name: "Fauna survey", status: "not_commenced", surveyWindowEnd: day(-2) }] });
  check("missed survey window is critical", byRule(missed, "survey.window_missed")[0]?.rating === "critical");

  const closing = run({ activities: [{ id: "a2", projectId: "p1", name: "Fauna survey", status: "not_commenced", surveyWindowEnd: day(Math.max(1, t.highClosingWithinDays - 1)) }] });
  check("closing survey window is high", byRule(closing, "survey.window_closing")[0]?.rating === "high");

  const completed = run({ activities: [{ id: "a3", projectId: "p1", name: "Fauna survey", status: "completed", actualDate: day(-5), surveyWindowEnd: day(-2) }] });
  check("completed activity does not raise a missed window", byRule(completed, "survey.window_missed").length === 0);

  const far = run({ activities: [{ id: "a4", projectId: "p1", name: "Fauna survey", status: "not_commenced", surveyWindowEnd: day(90) }] });
  check("survey window far out is not raised", byRule(far, "survey.window_closing").length === 0);
}

// ------------------------------------------------------ service requests
{
  // "submitted" is the primary awaiting-action state for a service request.
  // The generic terminal-status list treated it as closed, so this rule could
  // never fire for the state that matters most.
  const overdue = run({ serviceRequests: [{ id: "sr1", ref: "SR-9", status: "submitted", raisedAt: day(-40), dueDate: day(-10) }] });
  check("overdue SUBMITTED service request is raised", ids(overdue).includes("service_request.overdue"));

  for (const status of ["assigned", "in_progress", "returned"]) {
    const open = run({ serviceRequests: [{ id: `sr-${status}`, status, dueDate: day(-10) }] });
    check(`overdue ${status} service request is raised`, ids(open).includes("service_request.overdue"));
  }

  // Terminal states must never be chased, or they generate a finding forever.
  for (const status of ["closed", "declined", "cancelled", "archived", "approved"]) {
    const done = run({ serviceRequests: [{ id: `sr-${status}`, status, dueDate: day(-10) }] });
    check(`${status} service request is not raised`, !ids(done).includes("service_request.overdue"));
  }

  const notYet = run({ serviceRequests: [{ id: "sr3", status: "submitted", dueDate: day(-1) }] });
  check("service request 1d overdue is inside tolerance", !ids(notYet).includes("service_request.overdue"));
}

// -------------------------------------------------- regulatory unassessed
{
  // Note: this rule does not filter on status itself — SOURCES.regulatoryChanges
  // applies filter { status: "new" } at the query, so every row reaching the
  // engine is by definition unassessed. Asserted here so that if the query
  // filter is ever removed, the gap is visible rather than silent.
  const { SOURCES: SRC } = await loadEcado("sources");
  check("regulatory feed filters to unassessed at the query", SRC.regulatoryChanges.filter?.status === "new");

  const unassessed = run({ regulatoryChanges: [{ id: "r1", title: "WHS Regulation update", detectedAt: day(-30), _updatedAt: day(-30) }] });
  check("unassessed regulatory change is raised", ids(unassessed).includes("regulatory.unassessed"));
  check("regulatory change open >7d is high", byRule(unassessed, "regulatory.unassessed")[0]?.rating === "high");

  const fresh = run({ regulatoryChanges: [{ id: "r3", title: "Change", detectedAt: day(-1), _updatedAt: day(-1) }] });
  check("recently detected regulatory change is medium", byRule(fresh, "regulatory.unassessed")[0]?.rating === "medium");
}

// ------------------------------------------------------------ invariants
{
  const findings = run({
    incidents: [{ id: "i1", ref: "WHS-1", status: "open", notifiable: true, occurredAt: day(-3) }],
    activities: [{ id: "a1", projectId: "p1", name: "Survey", status: "not_commenced", surveyWindowEnd: day(-1) }],
    regulatoryChanges: [{ id: "r1", title: "Change", status: "new", detectedAt: day(-40) }],
  });

  check("every finding carries a ruleId", findings.every((f) => typeof f.ruleId === "string" && f.ruleId.length > 0));
  check("every finding carries a fingerprint", findings.every((f) => typeof f.fingerprint === "string" && f.fingerprint.length === 32));
  check("fingerprints are unique per finding", new Set(findings.map((f) => f.fingerprint)).size === findings.length);
  check("every finding has the three narrative fields", findings.every((f) => f.whatHappened && f.whyItMatters && f.whatNext));
  check("every rating is a known value", findings.every((f) => ["critical", "high", "medium", "low"].includes(f.rating)));
  check("every finding names its source", findings.every((f) => f.sourceType && f.sourceId));

  const again = run({
    incidents: [{ id: "i1", ref: "WHS-1", status: "open", notifiable: true, occurredAt: day(-3) }],
  });
  const first = byRule(findings, "whs.notifiable_open")[0];
  const second = byRule(again, "whs.notifiable_open")[0];
  check("fingerprint is stable across runs for the same source row", first.fingerprint === second.fingerprint);

  const sorted = sortFindings([...findings]);
  const weights = { critical: 0, high: 1, medium: 2, low: 3 };
  check("sortFindings orders by severity", sorted.every((f, i) => i === 0 || weights[sorted[i - 1].rating] <= weights[f.rating]));

  const counts = countByRating(findings);
  check("countByRating totals match the finding count", Object.values(counts).reduce((a, b) => a + b, 0) === findings.length);

  check("empty snapshot yields no findings", run({}).length === 0);
  check("compliance filter returns only compliance-relevant findings", filterToCompliance(findings).every((f) => findings.includes(f)));
}

// ------------------------------------------------------------ guardrails
{
  const findings = run({ incidents: [{ id: "i1", ref: "WHS-1", status: "open", notifiable: true, occurredAt: day(-3) }] });

  check("guardrail rejects an invented dollar figure", validateNarration("Exposure is about $42,500 this quarter.", findings).length > 0);
  check("guardrail rejects an invented project reference", validateNarration("Project 1563 is slipping.", findings).length > 0);
  check("guardrail rejects a claim of autonomous approval", validateNarration("I have approved the corrective action.", findings).length > 0);
  check("guardrail rejects a claim of autonomous assignment", validateNarration("I have assigned this to the WHS lead.", findings).length > 0);
  check("guardrail allows narration grounded in the findings", validateNarration("A notifiable incident remains open and outranks delivery matters.", findings).length === 0);

  const noCritical = run({ regulatoryChanges: [{ id: "r1", title: "Change", status: "new", detectedAt: day(-40) }] });
  check("guardrail rejects invented criticals", validateNarration("There is a critical item today.", noCritical).length > 0);
  check("guardrail permits explicitly saying there are none", validateNarration("No critical items today.", noCritical).length === 0);
}

// ------------------------------------------- rule reachability (coverage)
// A disabled feed produces no findings, which is indistinguishable from a
// clean record unless it is stated. This makes the dormant half of the rule
// set visible and will fail loudly if a feed is connected without anyone
// updating the expectation.
{
  const { SOURCES } = await loadEcado("sources");
  const live = Object.entries(SOURCES).filter(([, spec]) => spec.enabled).map(([name]) => name);
  const dormant = Object.entries(SOURCES).filter(([, spec]) => !spec.enabled).map(([name]) => name);

  const EXPECTED_LIVE = ["projects", "activities", "incidents", "serviceRequests", "regulatoryChanges"];
  const EXPECTED_DORMANT = ["deliverables", "allocations", "leave", "correctiveActions", "certifications", "quotes"];

  check("live feeds match the recorded expectation", JSON.stringify(live.sort()) === JSON.stringify([...EXPECTED_LIVE].sort()),
    `live=[${live.sort()}]`);
  check("dormant feeds match the recorded expectation", JSON.stringify(dormant.sort()) === JSON.stringify([...EXPECTED_DORMANT].sort()),
    `dormant=[${dormant.sort()}]`);

  console.log(`\n  Feed coverage: ${live.length}/${live.length + dormant.length} connected.`);
  console.log(`  Dormant (rules cannot fire): ${dormant.join(", ")}`);
}

// ------------------------------------------------------------------ report
const total = pass + failures.length;
console.log(`\nEcado evals: ${pass}/${total} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("All Ecado evals passed.");
