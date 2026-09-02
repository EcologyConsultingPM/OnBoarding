import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATASETS = {
  projects: { label: "Project Register", table: "projects", columns: ["id", "name", "client_name", "status", "start_date", "end_date", "budget_hours", "budget_dollars", "updated_at"] },
  activities: { label: "Project Activities", table: "project_activities", columns: ["id", "project_id", "staff_user_id", "title", "task_category", "budget_hours", "due_date", "status", "progress_percent", "acceptance_status", "updated_at"] },
  schedule: { label: "Project Schedule / Gantt", table: "project_schedule_items", columns: ["id", "project_id", "sort_order", "title", "detail", "start_date", "end_date", "milestone", "progress_percent", "status", "locked", "is_active", "updated_at"] },
  allocations: { label: "Project Allocations", table: "project_allocations", columns: ["id", "project_id", "staff_user_id", "role_on_project", "allocated_hours", "hourly_rate", "active", "updated_at"] },
  service_requests: { label: "Service Requests", table: "service_requests", columns: ["id", "request_type", "title", "details", "status", "admin_note", "created_by", "reviewed_by", "reviewed_at", "created_at", "updated_at"] },
  whs_forms: { label: "WHS / EC Form Register", table: "whs_forms", columns: ["id", "form_key", "form_title", "email", "project", "status", "submitted_at", "reviewed_at", "created_at", "updated_at"] },
  closeouts: { label: "Project Close-Out Register", table: "project_closeouts", columns: ["id", "project_id", "status", "success_score", "client_outcome", "delivery_summary", "lessons_learned", "stakeholder_feedback", "recommendations", "approved_at", "updated_at"] },
  improvements: { label: "Improvement Actions", table: "project_improvement_actions", columns: ["id", "project_id", "closeout_id", "title", "description", "assigned_to", "status", "due_date", "locked", "is_active", "updated_at"] },
  regulatory_sources: { label: "Regulatory Source Health", table: "regulatory_sources", columns: ["id", "source_key", "title", "category", "authority_name", "source_url", "active", "last_checked_at", "last_http_status", "last_successful_check_at", "failure_count", "last_error", "updated_at"] },
};

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\r\n");
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const datasetKey = new URL(request.url).searchParams.get("dataset") || "projects";
    const dataset = DATASETS[datasetKey];
    if (!dataset) return Response.json({ error: "Choose an approved operational dataset." }, { status: 400 });

    const { data, error } = await access.admin.from(dataset.table).select(dataset.columns.join(", ")).order("updated_at", { ascending: false }).limit(2000);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const csv = toCsv(data || [], dataset.columns);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ecology-${datasetKey}-export.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export { DATASETS };
