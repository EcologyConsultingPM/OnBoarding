/**
 * Ecado — rule engine.
 *
 * Pure and deterministic: (snapshot, thresholds, now) -> Finding[].
 * No I/O, no model, no randomness. This is what makes Ecado's ratings
 * reproducible and defensible. The LLM narrates these findings; it does
 * not produce them.
 *
 * Priority order is fixed: safety, compliance, client, delivery,
 * wellbeing, capacity, quality, commercial, improvement.
 */

import { createHash } from "node:crypto";
import { sortFindings } from "./types";
import { daysOverdue, daysUntil, workingDaysUntil, formatAuDate } from "./thresholds";
import { feedAvailable, rowsOf } from "./collect";
import { SAFETY_CRITICAL_FEEDS, SOURCES } from "./sources";

const s = (v) => (v == null ? "" : String(v));
const n = (v) => {
  if (v == null || v === "") return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
};
const truthy = (v) => v === true || v === "true" || v === "yes" || v === "Yes" || v === "Y" || v === 1;

// Terminal states differ per register, so a single generic list misreads them.
// "submitted" is terminal for a deliverable (it has been handed in) but is the
// primary AWAITING-ACTION state for a service request — the generic list marked
// those closed, so service_request.overdue could never fire for the one state
// that matters. Conversely "declined" and "archived" are terminal for a service
// request but were treated as open, so they would have been chased forever.
const TERMINAL_STATUSES = {
  serviceRequests: ["approved", "declined", "cancelled", "closed", "archived"],
  incidents: ["closed", "complete", "completed", "cancelled"],
  correctiveActions: ["closed", "complete", "completed", "cancelled", "verified"],
};
const GENERIC_TERMINAL = ["closed", "complete", "completed", "cancelled", "approved", "submitted", "done"];

const isOpen = (status, feed = null) => {
  const v = s(status).toLowerCase();
  if (!v) return true; // unknown status is treated as open — safer default
  return !(TERMINAL_STATUSES[feed] ?? GENERIC_TERMINAL).includes(v);
};

function fingerprint(ruleId, sourceType, sourceId) {
  return createHash("sha256").update(`${ruleId}::${sourceType}::${sourceId}`).digest("hex").slice(0, 32);
}

function make(args) {
  return { ...args, fingerprint: args.fingerprint ?? fingerprint(args.ruleId, args.sourceType, args.sourceId) };
}

const levelFor = (rating) => (rating === "critical" ? 4 : rating === "high" ? 3 : rating === "medium" ? 2 : 1);

/* ===================================================================== */
/* Rules                                                                 */
/* ===================================================================== */

/** R1 — Safety: notifiable incidents open, investigations overdue. */
function whsRules(snap, now) {
  if (!feedAvailable(snap, "incidents")) return [];
  const out = [];

  for (const r of rowsOf(snap, "incidents")) {
    const ref = s(r.ref) || s(r.id);
    if (!isOpen(r.status, "incidents")) continue;

    if (truthy(r.notifiable)) {
      out.push(
        make({
          ruleId: "whs.notifiable_open",
          rating: "critical",
          level: 4,
          domain: "safety",
          title: `Notifiable incident ${ref} remains open`,
          whatHappened: `Incident ${ref} occurred on ${formatAuDate(s(r.occurredAt))} and is flagged notifiable. Its status is "${s(r.status) || "unknown"}".`,
          whyItMatters: "Notifiable incidents carry statutory notification, preservation and record-keeping duties. An open notifiable event is the highest-consequence item on the portfolio and outranks all delivery and commercial matters.",
          whatNext: "Confirm the regulator notification was made and evidenced, confirm the site was preserved as required, and set a named investigation owner with a due date today.",
          sourceType: "whs_incident",
          sourceId: s(r.id),
          sourceRef: `Incident ${ref}`,
          dueInDays: null,
          detail: { severity: s(r.severity), status: s(r.status) },
        }),
      );
    }

    const invOverdue = daysOverdue(s(r.investigationDueDate), now);
    if (invOverdue > 0) {
      const rating = invOverdue > 14 ? "critical" : "high";
      out.push(
        make({
          ruleId: "whs.investigation_overdue",
          rating,
          level: levelFor(rating),
          domain: "safety",
          title: `Investigation overdue — incident ${ref}`,
          whatHappened: `The investigation for incident ${ref} was due ${formatAuDate(s(r.investigationDueDate))} and is ${invOverdue} day(s) overdue.`,
          whyItMatters: "Delayed investigation means the causal factors are still live on site and controls have not been verified. It also weakens the record if the event is later reviewed externally.",
          whatNext: "Assign or re-confirm the investigation owner, set a completion date within the week, and confirm interim controls are in place until then.",
          sourceType: "whs_incident",
          sourceId: s(r.id),
          sourceRef: `Incident ${ref}`,
          dueInDays: -invOverdue,
        }),
      );
    }
  }
  return out;
}

/** R2 — Compliance: corrective actions overdue. */
function correctiveActionRules(snap, t, now) {
  if (!feedAvailable(snap, "correctiveActions")) return [];
  const out = [];

  for (const r of rowsOf(snap, "correctiveActions")) {
    if (!isOpen(r.status, "correctiveActions")) continue;
    const overdue = daysOverdue(s(r.dueDate), now);
    if (overdue <= 0) continue;

    const rating = overdue > t.corrective_action.criticalOverdueDays ? "critical" : overdue >= t.corrective_action.highOverdueDays ? "high" : "medium";

    out.push(
      make({
        ruleId: "corrective_action.overdue",
        rating,
        level: levelFor(rating),
        domain: "compliance",
        title: `Corrective action overdue (${overdue}d) — ${s(r.title) || s(r.id)}`,
        whatHappened: `Corrective action "${s(r.title) || s(r.id)}" was due ${formatAuDate(s(r.dueDate))} and is ${overdue} day(s) overdue. Owner: ${s(r.owner) || "unassigned"}.`,
        whyItMatters: overdue > t.corrective_action.criticalOverdueDays
          ? "An action open beyond the critical threshold means an identified hazard has been left uncontrolled and documented as such. That record is the first thing an inspector or insurer reads."
          : "Overdue corrective actions indicate the control identified after an event has not been implemented. Recurrence risk is unmanaged.",
        whatNext: `Contact ${s(r.owner) || "the WHS coordinator"} for a completion date, or reassign. If the action cannot be completed, record the interim control and the reason.`,
        owner: s(r.owner) || null,
        sourceType: "corrective_action",
        sourceId: s(r.id),
        sourceRef: s(r.title) || s(r.id),
        dueInDays: -overdue,
      }),
    );
  }
  return out;
}

/** R3 — Compliance: certifications expired or expiring. */
function certificationRules(snap, t, now) {
  if (!feedAvailable(snap, "certifications")) return [];
  const out = [];

  for (const r of rowsOf(snap, "certifications")) {
    const until = daysUntil(s(r.expiryDate), now);
    if (until === null) continue;

    let rating = null;
    if (until < 0) rating = "critical";
    else if (until <= t.certification.highExpiringDays) rating = "high";
    else if (until <= t.certification.mediumExpiringDays) rating = "medium";
    if (!rating) continue;

    const who = s(r.staffEmail);
    const what = s(r.competency);
    out.push(
      make({
        ruleId: "certification.expiring",
        rating,
        level: levelFor(rating),
        domain: "compliance",
        title: until < 0 ? `Expired: ${what} — ${who}` : `${what} expires in ${until}d — ${who}`,
        whatHappened: until < 0
          ? `${who}'s ${what} expired ${formatAuDate(s(r.expiryDate))}, ${Math.abs(until)} day(s) ago.`
          : `${who}'s ${what} expires ${formatAuDate(s(r.expiryDate))}.`,
        whyItMatters: until < 0
          ? "Deploying a person without current competency exposes the company on both WHS duty and client contract compliance, and may void the deliverable if the work required a qualified person."
          : "Renewal lead times and course availability mean short notice becomes a fieldwork constraint.",
        whatNext: until < 0
          ? `Stand ${who} down from work requiring ${what} until renewed, check whether any completed work relied on it, and book the renewal.`
          : `Book the renewal and check scheduled activities in the expiry window that require ${what}.`,
        owner: who || null,
        sourceType: "certification",
        sourceId: s(r.id),
        sourceRef: `${who} — ${what}`,
        dueInDays: until,
      }),
    );
  }
  return out;
}

/** R4 — Client / delivery: deliverables overdue or at risk. */
function deliverableRules(snap, t, now) {
  if (!feedAvailable(snap, "deliverables")) return [];
  const projects = new Map(rowsOf(snap, "projects").map((p) => [s(p.id), p]));
  const out = [];

  for (const r of rowsOf(snap, "deliverables")) {
    if (!isOpen(r.status)) continue;

    const project = projects.get(s(r.projectId));
    const projRef = project ? s(project.ref) || s(project.id) : s(r.projectId);
    const client = project ? s(project.client) : "";
    const overdue = daysOverdue(s(r.dueDate), now);
    const wdUntil = workingDaysUntil(s(r.dueDate), now);
    const pct = n(r.percentComplete);
    const committed = truthy(r.clientCommitted);

    if (overdue > 0) {
      const rating = committed ? "critical" : "high";
      out.push(
        make({
          ruleId: "deliverable.overdue",
          rating,
          level: levelFor(rating),
          domain: "client",
          title: `Deliverable overdue (${overdue}d) — ${projRef}: ${s(r.name)}`,
          whatHappened: `"${s(r.name)}" on ${projRef}${client ? ` (${client})` : ""} was due ${formatAuDate(s(r.dueDate))} and is ${overdue} day(s) overdue at ${pct ?? "?"}% complete.`,
          whyItMatters: committed
            ? "This is a contracted commitment to the client. Silent lateness damages the relationship far more than an early, explained revision, and may affect payment milestones."
            : "Internal milestone slippage compounds into the client-facing date if it is not recovered now.",
          whatNext: `${s(r.owner) || "The deliverable owner"} to confirm a revised date today. If the client date moves, the PM contacts the client before the client notices.`,
          owner: s(r.owner) || null,
          sourceType: "deliverable",
          sourceId: s(r.id),
          sourceRef: `${projRef}: ${s(r.name)}`,
          dueInDays: -overdue,
        }),
      );
      continue;
    }

    if (wdUntil !== null && wdUntil >= 0) {
      let rating = null;
      if (wdUntil <= t.deliverable.highDueWithinDays && (pct ?? 0) < t.deliverable.highIncompletePct) {
        rating = "high";
      } else if (wdUntil <= t.deliverable.mediumDueWithinDays) {
        rating = "medium";
      }
      if (!rating) continue;

      out.push(
        make({
          ruleId: "deliverable.due_soon",
          rating,
          level: levelFor(rating),
          domain: "client",
          title: `Due in ${wdUntil} working day(s) — ${projRef}: ${s(r.name)}`,
          whatHappened: `"${s(r.name)}" on ${projRef} is due ${formatAuDate(s(r.dueDate))}, currently ${pct ?? "?"}% complete.`,
          whyItMatters: rating === "high"
            ? "Completion rate is below the level that reliably converts to an on-time submission, and review time has not been allowed for."
            : "Within the planning window where resourcing and review capacity need to be confirmed.",
          whatNext: rating === "high"
            ? `Confirm with ${s(r.owner) || "the owner"} that review and QA time is booked, or agree a revised date now.`
            : "Confirm the owner has capacity in the week before the due date.",
          owner: s(r.owner) || null,
          sourceType: "deliverable",
          sourceId: s(r.id),
          sourceRef: `${projRef}: ${s(r.name)}`,
          dueInDays: wdUntil,
        }),
      );
    }
  }
  return out;
}

/** R5 — Delivery: activity deadlines (survey windows where mapped, general due dates otherwise). */
function surveyWindowRules(snap, t, now) {
  if (!feedAvailable(snap, "activities")) return [];
  const projects = new Map(rowsOf(snap, "projects").map((p) => [s(p.id), p]));
  const out = [];

  for (const r of rowsOf(snap, "activities")) {
    if (!isOpen(r.status) || r.actualDate) continue;
    const closeIn = daysUntil(s(r.surveyWindowEnd), now);
    if (closeIn === null) continue;

    const projRef = projects.has(s(r.projectId)) ? s(projects.get(s(r.projectId)).ref) || s(r.projectId) : s(r.projectId);

    if (closeIn < 0) {
      out.push(
        make({
          ruleId: "survey.window_missed",
          rating: "critical",
          level: 4,
          domain: "delivery",
          title: `Deadline missed — ${projRef}: ${s(r.name)}`,
          whatHappened: `The deadline for "${s(r.name)}" was ${formatAuDate(s(r.surveyWindowEnd))} and the activity was not completed.`,
          whyItMatters: "Seasonal survey windows do not reopen. A missed window can push the assessment to the next season, invalidate the survey effort already spent, and expose the company on both the client program and the approval pathway.",
          whatNext: "Escalate today. Determine whether the guideline permits an alternative method or justification, advise the client of the program consequence, and record the cause for the close-out lessons register.",
          sourceType: "activity",
          sourceId: s(r.id),
          sourceRef: `${projRef}: ${s(r.name)}`,
          dueInDays: closeIn,
        }),
      );
    } else if (closeIn <= t.survey_window.highClosingWithinDays) {
      out.push(
        make({
          ruleId: "survey.window_closing",
          rating: "high",
          level: 3,
          domain: "delivery",
          title: `Deadline in ${closeIn}d — ${projRef}: ${s(r.name)}`,
          whatHappened: `"${s(r.name)}" must be completed by ${formatAuDate(s(r.surveyWindowEnd))}. Assigned to ${s(r.assignedTo) || "nobody"}.${truthy(r.weatherDependent) ? " Weather dependent." : ""}`,
          whyItMatters: "There is no recovery once the window closes. Weather dependency removes contingency days that the schedule assumes are available.",
          whatNext: `${s(r.assignedTo) ? `Confirm ${s(r.assignedTo)} is available and mobilised.` : "Assign a surveyor today."} Identify the fallback date and the fallback surveyor now, not on the day.`,
          owner: s(r.assignedTo) || null,
          sourceType: "activity",
          sourceId: s(r.id),
          sourceRef: `${projRef}: ${s(r.name)}`,
          dueInDays: closeIn,
        }),
      );
    }
  }
  return out;
}

/** R6 — Capacity: over-allocation and spare capacity. (No-op while the allocations feed is disabled.) */
function allocationRules(snap, t, now) {
  if (!feedAvailable(snap, "allocations")) return [];
  const horizonDays = 21;
  const byStaffWeek = new Map();

  for (const r of rowsOf(snap, "allocations")) {
    const week = s(r.weekStarting);
    const until = daysUntil(week, now);
    if (until === null || until < -7 || until > horizonDays) continue;

    const key = `${s(r.staffEmail)}::${week}`;
    const entry = byStaffWeek.get(key) ?? { allocated: 0, capacity: 0, week };
    entry.allocated += n(r.allocatedHours) ?? 0;
    entry.capacity = Math.max(entry.capacity, n(r.capacityHours) ?? 0);
    byStaffWeek.set(key, entry);
  }

  const out = [];
  for (const [key, v] of byStaffWeek) {
    const [staff, week] = key.split("::");
    if (!v.capacity) continue;
    const pct = Math.round((v.allocated / v.capacity) * 100);

    let rating = null;
    let domain = "capacity";
    if (pct >= t.allocation.criticalPct) { rating = "critical"; domain = "wellbeing"; }
    else if (pct >= t.allocation.highPct) { rating = "high"; domain = "wellbeing"; }
    else if (pct >= t.allocation.mediumPct) rating = "medium";
    else if (pct < t.allocation.underPct) rating = "low";
    if (!rating) continue;

    const over = pct >= t.allocation.mediumPct;
    out.push(
      make({
        ruleId: over ? "allocation.over" : "allocation.under",
        rating,
        level: levelFor(rating),
        domain,
        title: over ? `${staff} allocated ${pct}% — week of ${formatAuDate(week)}` : `${staff} at ${pct}% — spare capacity week of ${formatAuDate(week)}`,
        whatHappened: `${staff} is allocated ${v.allocated}h against ${v.capacity}h capacity (${pct}%) for the week beginning ${formatAuDate(week)}.`,
        whyItMatters: over
          ? pct >= t.allocation.criticalPct
            ? "Sustained allocation at this level is a fatigue and psychosocial hazard, not just a scheduling problem, and it is the point where quality review gets dropped first."
            : "The plan has no contingency. Any weather day, illness or client change turns into a missed date."
          : "Unused capacity that could absorb work from over-allocated staff or bring forward at-risk deliverables.",
        whatNext: over
          ? "Reallocate or reschedule before the week starts. Decide which deliverable moves, and tell the client if it is a committed date."
          : "Consider reallocating fieldwork or review work into this capacity.",
        owner: staff,
        sourceType: "staff_week",
        sourceId: key,
        sourceRef: `${staff} — ${week}`,
        dueInDays: daysUntil(week, now),
        detail: { pct, allocated: v.allocated, capacity: v.capacity },
      }),
    );
  }
  return out;
}

/** R7 — Commercial: forecast overrun and unapproved variations. (No-op — projects has no contract/variation columns.) */
function commercialRules(snap, t, now) {
  if (!feedAvailable(snap, "projects")) return [];
  const out = [];

  for (const r of rowsOf(snap, "projects")) {
    const ref = s(r.ref) || s(r.id);
    const contract = n(r.contractValue);
    const cost = n(r.costToDate);
    const pct = n(r.percentComplete);

    if (contract && cost && pct && pct > 5) {
      const forecast = cost / (pct / 100);
      const overrunPct = Math.round(((forecast - contract) / contract) * 100);
      if (overrunPct >= t.budget.highOverrunPct) {
        const rating = overrunPct >= t.budget.criticalOverrunPct ? "critical" : "high";
        out.push(
          make({
            ruleId: "budget.overrun",
            rating,
            level: levelFor(rating),
            domain: "commercial",
            title: `Forecast overrun ${overrunPct}% — ${ref}`,
            whatHappened: `${ref} has spent $${cost.toLocaleString("en-AU")} at ${pct}% complete against a contract of $${contract.toLocaleString("en-AU")}. Straight-line forecast at completion is $${Math.round(forecast).toLocaleString("en-AU")}, ${overrunPct}% over.`,
            whyItMatters: "At this burn rate the project finishes at a loss unless scope, method or price changes. The later this is raised with the client, the weaker the variation position.",
            whatNext: "PM to review the remaining scope and confirm whether the overrun is scope creep (variation), estimating error (price review) or efficiency (method review). Decide before the next invoice.",
            owner: s(r.manager) || null,
            sourceType: "project",
            sourceId: s(r.id),
            sourceRef: ref,
            detail: { forecast: Math.round(forecast), contract, cost, pct },
          }),
        );
      }
    }

    const varStatus = s(r.variationStatus).toLowerCase();
    if (varStatus && ["pending", "submitted", "awaiting_approval", "draft"].includes(varStatus)) {
      const waiting = daysOverdue(s(r.variationRaisedAt), now);
      if (waiting >= t.variation.highUnapprovedDays) {
        out.push(
          make({
            ruleId: "variation.unapproved",
            rating: "high",
            level: 3,
            domain: "commercial",
            title: `Variation unapproved ${waiting}d — ${ref}`,
            whatHappened: `A variation on ${ref} has been at "${varStatus}" since ${formatAuDate(s(r.variationRaisedAt))} — ${waiting} day(s).`,
            whyItMatters: "Work continuing against an unapproved variation is unrecoverable cost. It is also the most common cause of an invoice dispute at close-out.",
            whatNext: "Obtain written client approval or stop the varied scope. If the client will not confirm in writing, escalate to the director before further work is booked.",
            owner: s(r.manager) || null,
            sourceType: "project",
            sourceId: s(r.id),
            sourceRef: ref,
            dueInDays: -waiting,
          }),
        );
      }
    }
  }
  return out;
}

/** R8 — Service requests overdue. */
function serviceRequestRules(snap, now) {
  if (!feedAvailable(snap, "serviceRequests")) return [];
  const out = [];
  for (const r of rowsOf(snap, "serviceRequests")) {
    if (!isOpen(r.status, "serviceRequests")) continue;
    const overdue = daysOverdue(s(r.dueDate), now);
    if (overdue < 2) continue;
    const rating = overdue > 10 ? "high" : "medium";
    out.push(
      make({
        ruleId: "service_request.overdue",
        rating,
        level: levelFor(rating),
        domain: "delivery",
        title: `Service request overdue ${overdue}d — ${s(r.type) || s(r.id)}`,
        whatHappened: `Service request ${s(r.id)} (${s(r.type) || "unspecified type"}) was due ${formatAuDate(s(r.dueDate))}, owner ${s(r.owner) || "unassigned"}.`,
        whyItMatters: "Unactioned internal requests are usually a blocked staff member or an unresourced obligation sitting out of sight of the project schedule.",
        whatNext: "Action, reassign or close with a reason. Unassigned requests go to the operations manager.",
        owner: s(r.owner) || null,
        sourceType: "service_request",
        sourceId: s(r.id),
        sourceRef: s(r.type) || s(r.id),
        dueInDays: -overdue,
      }),
    );
  }
  return out;
}

/** R9 — Regulatory updates awaiting assessment. */
function regulatoryRules(snap, now) {
  if (!feedAvailable(snap, "regulatoryChanges")) return [];
  const out = [];
  for (const r of rowsOf(snap, "regulatoryChanges")) {
    const daysOpen = r._updatedAt ? Math.round((now.getTime() - new Date(r._updatedAt).getTime()) / 86_400_000) : null;
    out.push(
      make({
        ruleId: "regulatory.unassessed",
        rating: daysOpen !== null && daysOpen > 7 ? "high" : "medium",
        level: daysOpen !== null && daysOpen > 7 ? 3 : 2,
        domain: "compliance",
        title: `Regulatory update awaiting review — ${s(r.instrument)}`,
        whatHappened: `"${s(r.instrument)}" was detected and has not yet been assessed for impact.`,
        whyItMatters: "An unassessed regulatory change means the firm cannot yet say whether existing methods, templates or approvals need updating.",
        whatNext: "Assign a reviewer to assess impact on active projects and templates, then close out via Regulatory Watch.",
        sourceType: "regulatory_update",
        sourceId: s(r.id),
        sourceRef: s(r.instrument),
        dueInDays: null,
      }),
    );
  }
  return out;
}

/** R10 — Data gaps are findings. A missing safety feed is a risk, not a blank section. */
function gapRules(snap) {
  return snap.gaps.map((gap) => {
    const feed = Object.values(snap.feeds).find((f) => f.gap === gap)?.feed ?? "unknown";
    const safety = SAFETY_CRITICAL_FEEDS.includes(feed);
    const rating = safety ? "high" : "medium";
    return make({
      ruleId: `data.gap.${gap.reason}`,
      rating,
      level: levelFor(rating),
      domain: safety ? "safety" : "improvement",
      title: `Data gap — ${feed} (${gap.reason.replace("_", " ")})`,
      whatHappened: gap.detail,
      whyItMatters: safety
        ? "Ecado cannot see this safety or compliance data, so an empty section in the brief does not mean there is nothing wrong. The gap masks risk."
        : `Rules that cannot run: ${gap.requiredFor.join(", ")}. Findings in this area are incomplete.`,
      whatNext: `Connect ${SOURCES[feed]?.table ?? feed} and map its fields in lib/ecado/sources.js, or confirm the module is genuinely not in use and disable the feed deliberately.`,
      sourceType: "data_feed",
      sourceId: feed,
      sourceRef: feed,
    });
  });
}

/* ===================================================================== */
/* Entry points                                                          */
/* ===================================================================== */

export function classify(snapshot, thresholds, now = new Date()) {
  return sortFindings([
    ...whsRules(snapshot, now),
    ...correctiveActionRules(snapshot, thresholds, now),
    ...certificationRules(snapshot, thresholds, now),
    ...deliverableRules(snapshot, thresholds, now),
    ...surveyWindowRules(snapshot, thresholds, now),
    ...allocationRules(snapshot, thresholds, now),
    ...commercialRules(snapshot, thresholds, now),
    ...serviceRequestRules(snapshot, now),
    ...regulatoryRules(snapshot, now),
    ...gapRules(snapshot),
  ]);
}

/** Narrow the finding set to a single project, including its staff and activities. */
export function filterToProject(findings, snapshot, projectId) {
  const projects = rowsOf(snapshot, "projects");
  const match = projects.find((p) => s(p.id) === projectId || s(p.ref).toLowerCase() === projectId.toLowerCase());
  const id = match ? s(match.id) : projectId;

  const deliverableIds = new Set(rowsOf(snapshot, "deliverables").filter((d) => s(d.projectId) === id).map((d) => s(d.id)));
  const activityIds = new Set(rowsOf(snapshot, "activities").filter((a) => s(a.projectId) === id).map((a) => s(a.id)));

  return findings.filter(
    (f) =>
      (f.sourceType === "project" && f.sourceId === id) ||
      (f.sourceType === "deliverable" && deliverableIds.has(f.sourceId)) ||
      (f.sourceType === "activity" && activityIds.has(f.sourceId)),
  );
}

/** Compliance-only view. */
export function filterToCompliance(findings) {
  return findings.filter((f) => f.domain === "safety" || f.domain === "compliance");
}

/** Capacity-only view. */
export function filterToCapacity(findings) {
  return findings.filter((f) => f.domain === "capacity" || f.domain === "wellbeing");
}
