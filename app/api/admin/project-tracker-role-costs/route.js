import { requireSession } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { loadTrackerChargeRates } from "../../../../lib/projectTrackerChargeRates";
import { loadTrackerEntryPages } from "../../../../lib/projectTrackerUnassignedActuals";
import { summarizeTrackerRoleCosts, TRACKER_INTERNAL_MILEAGE_RATE } from "../../../../lib/projectTrackerRoleCosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ENTRY_COLUMNS = "id, project_id, staff_user_id, budget_source_id, budget_allocation_id, hours, custom_data";
const SOURCE_COLUMNS = "id, project_id, source_type, approval_status";
const ALLOCATION_COLUMNS = "id, project_id, budget_source_id, status, hours_consumed, charge_out_spend";
const LEGACY_RATE_COLUMNS = "id, staff_user_id, hourly_rate";

function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  const vary = (headers.get("Vary") || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!vary.some((value) => value.toLowerCase() === "authorization")) vary.push("Authorization");
  headers.set("Vary", vary.join(", "));
  return new Response(response.body, { status: response.status, headers });
}

function json(body, status = 200) {
  return privateResponse(Response.json(body, { status }));
}

async function readProjectPages(admin, table, columns, projectId) {
  const result = await loadTrackerEntryPages(() => admin.from(table).select(columns).eq("project_id", projectId));
  if (result.error) throw new Error(`Unable to load ${table}: ${result.error.message}`);
  return result.data;
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return privateResponse(access.error);
    // Deny staff before visibility checks or any financial table reads.
    if (access.isAdmin !== true) return json({ error: "Administrator access is required." }, 403);
    const denied = await requirePortalResource(access, "admin.projects.tracker");
    if (denied) return privateResponse(denied);
    const { searchParams } = new URL(request.url);
    const projectId = String(searchParams.get("projectId") || "").trim();
    if (searchParams.getAll("projectId").length !== 1 || [...searchParams.keys()].some((key) => key !== "projectId") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
      return json({ error: "A valid project is required." }, 400);
    }
    const { data: project, error: projectError } = await access.admin.from("projects")
      .select("id, name, default_hourly_rate").eq("id", projectId).is("deleted_at", null)
      .neq("status", "archived").limit(1).maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!project) return json({ error: "Project not found." }, 404);
    const [entries, sources, allocations, legacyRates, ratesByProject] = await Promise.all([
      readProjectPages(access.admin, "project_tracker_entries", ENTRY_COLUMNS, project.id),
      readProjectPages(access.admin, "project_budget_sources", SOURCE_COLUMNS, project.id),
      readProjectPages(access.admin, "project_budget_allocations", ALLOCATION_COLUMNS, project.id),
      readProjectPages(access.admin, "project_allocations", LEGACY_RATE_COLUMNS, project.id),
      loadTrackerChargeRates(access.admin, [project.id]),
    ]);
    const legacyRateByStaff = new Map(legacyRates.map((row) => [row.staff_user_id, Number(row.hourly_rate) || 0]));
    // Confirmed internal mileage is 0.90/km. Current project mileage pricing
    // comes only from ratesByProject.get(project.id).get("Mileage") once the
    // parent extends its card loader. No UI query overrides or company defaults.
    // Historical mileage spend uses trusted snapshots, never today's card.
    const overview = summarizeTrackerRoleCosts({
      projectId: project.id, entries, sources, allocations, ratesByProject, legacyRateByStaff,
      defaultHourlyRate: Number(project.default_hourly_rate) || 0,
      mileageInternalRate: TRACKER_INTERNAL_MILEAGE_RATE,
    });
    return json({ projectId: project.id, projectName: project.name, overview });
  } catch (error) {
    // Never return SQL, custom_data snapshots, rate cards or configuration in
    // failures. Success returns aggregate fields only, not raw staff entries.
    console.error("Project tracker role cost overview failed:", error);
    return json({ error: "The role cost overview could not be loaded. Please refresh or contact an administrator." }, 500);
  }
}
