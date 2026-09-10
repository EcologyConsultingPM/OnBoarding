/**
 * ⚠ THE ONE FILE THAT HAD TO BE EDITED.
 *
 * Maps Ecado's logical feeds onto this app's real table and column names —
 * verified against live schema introspection, not guessed from the
 * original kit's assumed structure (which used a different app's naming).
 *
 * Rule, unchanged from the source kit: if a required column does not exist,
 * leave it null. The affected rule is skipped with an explicit gap note.
 * A confident brief built on a wrong or guessed column is worse than an
 * honest gap — several feeds below are deliberately disabled because this
 * app genuinely has no table for them yet.
 */

export const SOURCES = {
  projects: {
    enabled: true,
    table: "projects",
    fields: {
      id: "id",
      ref: "name", // no separate project_number column — name is the identifier used everywhere else in this app
      client: "client_name",
      manager: "project_lead_user_id", // uuid, not email — resolved via a join in collect.js
      status: "status",
      startDate: "start_date",
      endDate: "end_date",
      percentComplete: null, // not tracked at project level in this schema
      contractValue: null, // no contract_value column — budget_dollars is the internal budget, not a contract figure
      costToDate: null, // no cost-to-date rollup at project level; charge_out_spend lives per-allocation
      invoicedToDate: null,
      variationStatus: null, // no variations concept in this schema
      variationRaisedAt: null,
    },
    updatedAtColumn: "updated_at",
    filter: { status: "active" },
    requiredFor: ["project.health"],
  },

  // Deliverables have no dedicated table in this schema — project_activities
  // (mapped below as `activities`) is what carries due dates and status,
  // so a separate deliverables feed would duplicate that rule, not add one.
  deliverables: {
    enabled: false,
    table: null,
    fields: {},
    updatedAtColumn: null,
    requiredFor: ["deliverable.overdue", "deliverable.due_soon"],
  },

  activities: {
    enabled: true,
    table: "project_activities",
    fields: {
      id: "id",
      projectId: "project_id",
      name: "title",
      assignedTo: "staff_user_id", // uuid, resolved to email in collect.js
      plannedDate: "start_date",
      actualDate: "completed_at",
      status: "status",
      surveyWindowStart: null, // no dedicated survey-window columns — due_date below stands in for a general deadline
      surveyWindowEnd: "due_date",
      weatherDependent: null,
    },
    updatedAtColumn: "updated_at",
    filter: { is_active: true },
    requiredFor: ["survey.window_closing", "activity.overdue"],
  },

  // Staff capacity in this app is computed live from activities + leave +
  // task briefs (see app/api/admin/staff-capacity/route.js) — there is no
  // simple capacity_allocations table to point at. Porting the allocation
  // rule properly means reusing that route's own aggregation, not a field
  // mapping, so it is disabled here rather than mapped to the wrong thing.
  allocations: {
    enabled: false,
    table: null,
    fields: {},
    updatedAtColumn: null,
    requiredFor: ["allocation.over", "allocation.under"],
  },

  leave: {
    enabled: false,
    table: null,
    fields: {},
    updatedAtColumn: null,
    requiredFor: ["leave.impact"],
  },

  // Corrective actions exist only as a jsonb array embedded inside each
  // incident_reports row (incident_reports.corrective_actions), not as
  // their own table with due dates and owners. Flattening that into
  // synthetic rows was judged more likely to mislead than an honest gap —
  // left disabled; the incidents feed below still covers the safety-critical
  // open/notifiable signal.
  correctiveActions: {
    enabled: false,
    table: null,
    fields: {},
    updatedAtColumn: null,
    requiredFor: ["corrective_action.overdue"],
  },

  incidents: {
    enabled: true,
    table: "incident_reports",
    // Narrative fields deliberately NOT mapped — Ecado reports status, not detail.
    fields: {
      id: "id",
      ref: "id",
      severity: "severity_rating",
      notifiable: "notifiable", // stored as text ("Yes"/"No"), handled by classify.js's truthy()
      status: "status",
      occurredAt: "incident_date",
      investigationDueDate: null, // investigation_target is a text field, not a reliably-parseable date
    },
    updatedAtColumn: "updated_at",
    requiredFor: ["whs.notifiable_open", "whs.investigation_overdue"],
  },

  // No staff_competencies / certifications table exists yet.
  certifications: {
    enabled: false,
    table: null,
    fields: {},
    updatedAtColumn: null,
    requiredFor: ["certification.expiring", "capability.gap"],
  },

  serviceRequests: {
    enabled: true,
    table: "service_requests",
    fields: {
      id: "id",
      type: "request_type",
      raisedAt: "created_at",
      dueDate: "due_date",
      status: "status",
      owner: "assigned_to", // uuid, resolved to email in collect.js
    },
    updatedAtColumn: "updated_at",
    requiredFor: ["service_request.overdue"],
  },

  // quote_pipeline tracks issued quotes with sent_on, not a decision-due
  // date, and quote_drafts tracks pre-issue drafting. Neither matches the
  // kit's "quote awaiting client decision" concept cleanly enough to map
  // without guessing at a decision deadline that doesn't exist as data.
  quotes: {
    enabled: false,
    table: null,
    fields: {},
    updatedAtColumn: null,
    requiredFor: ["quote.decision_due"],
  },

  regulatoryChanges: {
    enabled: true,
    table: "regulatory_updates",
    fields: {
      id: "id",
      instrument: "title",
      jurisdiction: null, // not a separate column — folded into title/summary text
      effectiveDate: "review_due_date",
      assessmentStatus: "status",
      affectsActiveProjects: null,
    },
    updatedAtColumn: "updated_at",
    filter: { status: "new" },
    requiredFor: ["regulatory.unassessed"],
  },
};

/** Feeds whose absence should be surfaced loudly — safety and compliance cannot be silent. */
export const SAFETY_CRITICAL_FEEDS = ["incidents", "correctiveActions", "certifications"];
