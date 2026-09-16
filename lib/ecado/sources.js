/**
 * Ecado data-source contract.
 *
 * This module is intentionally data-only. The collector uses these mappings to
 * read approved business tables and normalise their columns for the rule engine.
 * Keep disabled feeds explicit: an absent feed is reported as a data gap rather
 * than being mistaken for a clean register.
 */

const source = (table, fields, options = {}) => ({
  table,
  fields,
  enabled: options.enabled !== false,
  updatedAtColumn: options.updatedAtColumn || "updated_at",
  requiredFor: options.requiredFor || [],
  ...(options.filter ? { filter: options.filter } : {}),
});

export const SOURCES = {
  projects: source("projects", {
    id: "id", name: "name", status: "status", manager: "project_lead_user_id",
    client: "client_name", startDate: "start_date", endDate: "end_date",
    budgetHours: "budget_hours", budgetDollars: "budget_dollars",
  }, { requiredFor: ["project health", "delivery oversight"] }),
  activities: source("project_activities", {
    id: "id", projectId: "project_id", name: "title", status: "status",
    dueDate: "due_date", owner: "assigned_to", surveyWindowEnd: "survey_window_end",
    actualDate: "actual_date", detail: "detail",
  }, { requiredFor: ["activity deadlines", "survey windows"] }),
  incidents: source("incident_reports", {
    id: "id", ref: "safework_reference", status: "status", notifiable: "notifiable",
    occurredAt: "incident_date", investigationDueDate: "investigation_due_date",
  }, { requiredFor: ["WHS incident escalation"] }),
  serviceRequests: source("service_requests", {
    id: "id", type: "request_type", status: "status", owner: "assigned_to",
    raisedAt: "created_at", dueDate: "due_date",
  }, { requiredFor: ["internal service-request oversight"] }),
  regulatoryChanges: source("regulatory_updates", {
    id: "id", instrument: "title", status: "status", detectedAt: "detected_at",
  }, { filter: { status: "new" }, requiredFor: ["regulatory review"] }),
  deliverables: source("project_deliverables", {
    id: "id", projectId: "project_id", title: "title", status: "status",
    dueDate: "due_date", owner: "assigned_to",
  }, { enabled: false, requiredFor: ["deliverable oversight"] }),
  allocations: source("project_allocations", {
    id: "id", projectId: "project_id", staffEmail: "staff_user_id",
    allocatedHours: "allocated_hours", status: "active",
  }, { enabled: false, requiredFor: ["capacity oversight"] }),
  leave: source("leave_requests", {
    id: "id", staffEmail: "staff_user_id", status: "status", startDate: "start_date", endDate: "end_date",
  }, { enabled: false, requiredFor: ["leave and capacity oversight"] }),
  correctiveActions: source("corrective_actions", {
    id: "id", ref: "reference", status: "status", dueDate: "due_date", owner: "assigned_to",
  }, { enabled: false, requiredFor: ["corrective-action oversight"] }),
  certifications: source("staff_certifications", {
    id: "id", staffEmail: "staff_user_id", competency: "competency", expiryDate: "expiry_date",
  }, { enabled: false, requiredFor: ["competency expiry oversight"] }),
  quotes: source("quotes", {
    id: "id", ref: "reference", status: "status", dueDate: "due_date", owner: "owner_id",
  }, { enabled: false, requiredFor: ["commercial oversight"] }),
};

export const SAFETY_CRITICAL_FEEDS = ["incidents", "regulatoryChanges"];
