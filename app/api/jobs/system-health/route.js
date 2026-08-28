import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("System health check server configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function databaseCheck(admin, table) {
  const started = Date.now();
  const { error } = await admin.from(table).select("id", { head: true, count: "exact" }).limit(1);
  if (error) throw new Error(error.message);
  return { table, latency_ms: Date.now() - started };
}

// Daily Vercel Cron health check. This reports application dependency health only;
// it does not inspect private user content, download data or modify business records.
export async function GET(request) {
  if (!authorised(request)) return Response.json({ error: "Unauthorised scheduler." }, { status: 401 });
  const checkedAt = new Date().toISOString();
  const admin = adminClient();
  const checks = [];
  try {
    const tables = ["projects", "portal_events", "regulatory_sources", "project_tracker_templates", "backup_runs"];
    for (const table of tables) {
      try {
        const details = await databaseCheck(admin, table);
        checks.push({ service_key: `database:${table}`, status: "healthy", summary: `${table} is reachable.`, details });
      } catch (error) {
        checks.push({ service_key: `database:${table}`, status: "failed", summary: `${table} could not be queried.`, details: { error: String(error.message || error).slice(0, 500) } });
      }
    }
    try {
      const { error } = await admin.storage.listBuckets();
      if (error) throw new Error(error.message);
      checks.push({ service_key: "supabase-storage", status: "healthy", summary: "Supabase Storage API is reachable.", details: { archive_coverage: "not independently archived" } });
    } catch (error) {
      checks.push({ service_key: "supabase-storage", status: "failed", summary: "Supabase Storage API could not be queried.", details: { error: String(error.message || error).slice(0, 500), archive_coverage: "not independently archived" } });
    }
    const records = checks.map((check) => ({ ...check, checked_at: checkedAt }));
    const { error } = await admin.from("system_health_runs").insert(records);
    if (error) throw new Error(error.message);
    const failed = checks.filter((check) => check.status === "failed");
    return Response.json({ ok: failed.length === 0, checked_at: checkedAt, checks });
  } catch (error) {
    return Response.json({ error: error.message || "System health check failed.", checked_at: checkedAt }, { status: 500 });
  }
}
