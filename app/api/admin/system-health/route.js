import { requireSession } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coverageStatus(run, now = Date.now()) {
  const coverage = run?.coverage && typeof run.coverage === "object" ? run.coverage : {};
  const completed = Date.parse(run?.finished_at || "");
  const fresh = Number.isFinite(completed) && completed <= now && now - completed <= 30 * 60 * 60 * 1000;
  const succeeded = run?.status === "succeeded";
  return {
    database: succeeded && fresh && coverage.database_roles === true && coverage.database_schema === true && coverage.database_data === true,
    storage: succeeded && fresh && coverage.storage_objects === true,
    fresh,
    stale: succeeded && !fresh,
  };
}
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });

export async function GET(request) {
  const access = await requireSession(request);
  if (access.error) return access.error;
  if (!access.isAdmin) return reply({ error: "Administrator access is required.", code: "HEALTH_FORBIDDEN" }, 403);
  try {
    const [backupsResult, healthResult] = await Promise.all([
      // Production backup_runs is keyed by run_id; no id column is required.
      access.admin.from("backup_runs").select("run_id, status, workflow_name, started_at, finished_at, archive_bytes, coverage, retention_days, error_summary").order("started_at", { ascending: false }).limit(12),
      access.admin.from("system_health_runs").select("id, service_key, status, summary, details, checked_at").order("checked_at", { ascending: false }).limit(30),
    ]);
    if (backupsResult.error || healthResult.error) throw new Error("HEALTH_QUERY_FAILED");
    const backups = backupsResult.data || [];
    const healthRuns = healthResult.data || [];
    const latestBackup = backups[0] || null;
    return reply({
      latest_backup: latestBackup,
      backup_coverage: coverageStatus(latestBackup),
      internal_registers_backup_scope: {
        configured: true,
        method: "Existing daily full-schema and full-data database dump",
        tables: ["internal_register_staff", "internal_training_records"],
        note: "Configuration is not proof of a successful retained archive; check the current backup run and coverage above.",
      },
      backups,
      health_runs: healthRuns,
      recent_issues: healthRuns.filter((run) => run.status !== "healthy").slice(0, 10),
      generated_at: new Date().toISOString(),
    });
  } catch {
    return reply({ error: "System health could not be loaded. Please try again.", code: "HEALTH_QUERY_FAILED" }, 500);
  }
}
