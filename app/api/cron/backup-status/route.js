import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request) {
  const expected = process.env.BACKUP_STATUS_TOKEN || "";
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Backup monitoring server configuration is incomplete.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normaliseStatus(value) {
  return ["running", "succeeded", "failed"].includes(value) ? value : "";
}

function text(value, max = 800) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// This endpoint receives backup metadata only. It cannot receive dump contents,
// download an archive, access application records or restore a database.
export async function POST(request) {
  if (!authorised(request)) return Response.json({ error: "Unauthorised backup reporter." }, { status: 401 });
  try {
    const body = await request.json();
    const runId = text(body?.run_id, 120);
    const status = normaliseStatus(body?.status);
    if (!runId || !status) return Response.json({ error: "run_id and a valid status are required." }, { status: 400 });

    const now = new Date().toISOString();
    const coverage = {
      database_roles: true,
      database_schema: true,
      database_data: true,
      storage_objects: false,
      ...(body?.coverage && typeof body.coverage === "object" ? body.coverage : {}),
    };
    const record = {
      run_id: runId,
      status,
      workflow_name: text(body?.workflow_name, 120) || "daily-private-database-backup",
      started_at: body?.started_at || now,
      finished_at: status === "running" ? null : (body?.finished_at || now),
      archive_bytes: Number.isFinite(Number(body?.archive_bytes)) ? Math.max(0, Math.floor(Number(body.archive_bytes))) : null,
      archive_sha256: text(body?.archive_sha256, 128) || null,
      coverage,
      retention_days: Math.min(30, Math.max(1, Number(body?.retention_days) || 7)),
      error_summary: status === "failed" ? text(body?.error_summary, 800) || "Backup workflow reported a failure." : null,
      updated_at: now,
    };

    const { error } = await adminClient().from("backup_runs").upsert(record, { onConflict: "run_id" });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, run_id: runId, status });
  } catch (error) {
    return Response.json({ error: error.message || "Could not record backup status." }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}
