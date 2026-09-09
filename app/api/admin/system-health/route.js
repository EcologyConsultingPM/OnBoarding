import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coverageStatus(run) {
  const coverage = run?.coverage && typeof run.coverage === "object" ? run.coverage : {};
  return {
    database: Boolean(coverage.database_roles && coverage.database_schema && coverage.database_data),
    storage: Boolean(coverage.storage_objects),
  };
}

export async function GET(request) {
  const access = await requireSession(request);
  if (access.error) return access.error;
  if (!access.isAdmin) return Response.json({ error: "Administrator access is required." }, { status: 403 });
  try {
    const [backupsResult, healthResult] = await Promise.all([
      access.admin.from("backup_runs").select("id, run_id, status, workflow_name, started_at, finished_at, archive_bytes, coverage, retention_days, error_summary").order("started_at", { ascending: false }).limit(12),
      access.admin.from("system_health_runs").select("id, service_key, status, summary, details, checked_at").order("checked_at", { ascending: false }).limit(30),
    ]);
    if (backupsResult.error) throw new Error(backupsResult.error.message);
    if (healthResult.error) throw new Error(healthResult.error.message);
    const backups = backupsResult.data || [];
    const healthRuns = healthResult.data || [];
    const latestBackup = backups[0] || null;
    const recentIssues = healthRuns.filter((run) => run.status !== "healthy").slice(0, 10);
    return Response.json({
      latest_backup: latestBackup,
      backup_coverage: coverageStatus(latestBackup),
      backups,
      health_runs: healthRuns,
      recent_issues: recentIssues,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}
