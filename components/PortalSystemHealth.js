"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, DatabaseBackup, HardDrive, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

function formatDate(value) {
  if (!value) return "Not recorded yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded yet" : date.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Manifest pending";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function PortalSystemHealth() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/system-health", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not load system health.");
      setData(body);
    } catch (requestError) {
      setError(requestError.message || "Could not load system health.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const latest = data?.latest_backup || null;
  const backups = Array.isArray(data?.backups) ? data.backups : [];
  const issues = Array.isArray(data?.recent_issues) ? data.recent_issues : [];
  const health = Array.isArray(data?.health_runs) ? data.health_runs : [];
  const healthyCount = useMemo(() => health.filter((run) => run.status === "healthy").length, [health]);

  return (
    <section className="pm-system" aria-label="Backup and system health">
      <header className="pm-system__hero">
        <div>
          <span className="pm-kicker">Operational assurance</span>
          <h2><Activity size={20} /> Backup & system health</h2>
          <p>Monitor the private daily database archive, scheduled checks and known system issues. This workspace reports operational evidence; it never exposes backup files, database credentials or restore controls.</p>
        </div>
        <button type="button" className="pm-submit pm-submit--compact" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh status</button>
      </header>

      {error ? <div className="pm-notice error"><ShieldAlert size={16} /><span>{error}</span></div> : null}
      <div className="pm-system__metrics">
        <Metric icon={DatabaseBackup} label="Latest database archive" value={latest?.status === "succeeded" ? "Succeeded" : latest?.status === "running" ? "Running" : latest?.status === "failed" ? "Attention required" : "Not configured"} note={latest ? formatDate(latest.finished_at || latest.started_at) : "Configure private workflow secrets to begin"} tone={latest?.status === "succeeded" ? "good" : latest?.status === "failed" ? "bad" : "warn"} />
        <Metric icon={HardDrive} label="Database coverage" value={data?.backup_coverage?.database ? "Roles, schema & data" : "Pending first archive"} note={latest ? `${formatBytes(latest.archive_bytes)} · ${latest.retention_days || 7}-day retention` : "Private encrypted archive"} tone={data?.backup_coverage?.database ? "good" : "warn"} />
        <Metric icon={HardDrive} label="Uploaded file coverage" value={data?.backup_coverage?.storage ? "Independently archived" : "Not independently archived"} note="Storage files are monitored separately from the database export" tone={data?.backup_coverage?.storage ? "good" : "warn"} />
        <Metric icon={issues.length ? AlertTriangle : CheckCircle2} label="Known system issues" value={loading ? "Checking…" : issues.length ? `${issues.length} recent` : "None recorded"} note={`${healthyCount} successful recent health checks`} tone={issues.length ? "bad" : "good"} />
      </div>

      <div className="pm-system__grid">
        <section className="pm-system__card">
          <div className="pm-system__head"><div><span className="pm-kicker">Archive log</span><h3>Recent private backup runs</h3></div><DatabaseBackup size={18} /></div>
          {loading ? <p className="pm-muted">Loading backup records…</p> : backups.length === 0 ? <p className="pm-muted">No backup run has been reported yet. Once the private daily workflow is configured, its successful and failed status will be shown here.</p> : <div className="pm-system__list">{backups.map((run) => <div className="pm-system__row" key={run.id || run.run_id}><span className={`pm-system__dot ${run.status}`} /><span><strong>{run.status === "succeeded" ? "Database archive completed" : run.status === "failed" ? "Database archive failed" : "Database archive running"}</strong><small>{formatDate(run.finished_at || run.started_at)} · {formatBytes(run.archive_bytes)}</small>{run.error_summary ? <em>{run.error_summary}</em> : null}</span></div>)}</div>}
        </section>
        <section className="pm-system__card">
          <div className="pm-system__head"><div><span className="pm-kicker">System log</span><h3>Recent health checks & warnings</h3></div><Activity size={18} /></div>
          {loading ? <p className="pm-muted">Loading health records…</p> : health.length === 0 ? <p className="pm-muted">No scheduled health check has reported yet. The first daily check will verify the core portal tables and Storage connection.</p> : <div className="pm-system__list">{health.slice(0, 12).map((run) => <div className="pm-system__row" key={run.id}><span className={`pm-system__dot ${run.status === "healthy" ? "succeeded" : run.status}`} /><span><strong>{run.service_key}</strong><small>{run.summary} · {formatDate(run.checked_at)}</small>{run.details?.error ? <em>{run.details.error}</em> : null}</span></div>)}</div>}
        </section>
      </div>
      <p className="pm-system__footnote">Free-tier protection: the private archive is database-only and short-retention. Supabase Storage files are operationally monitored, but are not included in the independent archive until a separate free file-archive destination is configured.</p>
    </section>
  );
}

function Metric({ icon: Icon, label, value, note, tone }) {
  return <article className={`pm-system__metric ${tone || ""}`}><span className="pm-system__metric-icon"><Icon size={18} /></span><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></article>;
}
