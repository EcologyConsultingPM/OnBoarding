"use client";

import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, AlertTriangle, Clock, ClipboardCheck, FileText, X, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const TYPE_LABEL = {
  daily_risk_assessment: "Daily Risk Assessment", office_risk_assessment: "Office Risk Assessment",
  injury_incident: "Injury / Incident", near_miss: "Near Miss", site_erp: "Site ERP",
  journey_plan: "Journey Plan", pre_mobilisation: "Pre-Mobilisation", toolbox_talk: "Toolbox Talk",
  hazard_report: "Hazard Report",
};

// Default compliance checks offered when auditing a submission.
const DEFAULT_CHECKS = [
  "Form completed in full",
  "Hazards & controls adequate",
  "Submitted within required timeframe",
  "Correct classification (incident/near miss)",
  "Corrective actions identified where needed",
];

function Gauge({ pct }) {
  const r = 54, c = 2 * Math.PI * r;
  const val = pct == null ? 0 : pct;
  const dash = (val / 100) * c;
  const colour = val >= 90 ? "#2c6a34" : val >= 70 ? "#c9962a" : "#a5342a";
  return (
    <svg viewBox="0 0 140 140" className="wcd-gauge">
      <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(18,33,26,.1)" strokeWidth="14" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={colour} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`} transform="rotate(-90 70 70)" />
      <text x="70" y="66" textAnchor="middle" className="wcd-gauge-num">{pct == null ? "—" : pct + "%"}</text>
      <text x="70" y="86" textAnchor="middle" className="wcd-gauge-lbl">compliant</text>
    </svg>
  );
}

/* ---------------------------------------------------------------
   Submitted-form viewer for the audit modal. `details` is an
   arbitrary jsonb blob whose shape differs per form_type (some
   forms are flat key/value, others — like the Daily Risk Assessment
   — nest checklist rows and dynamic tables), so this renders
   generically off the runtime shape of each value rather than
   assuming a specific form's schema.
----------------------------------------------------------------- */
function humanizeKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
function isSignatureValue(value) {
  return typeof value === "string" && value.startsWith("data:image");
}
function isBlank(value) {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function DetailValue({ value }) {
  if (isBlank(value)) return <span className="wcd-detail-empty">—</span>;
  if (isSignatureValue(value)) return <img src={value} alt="Signature" className="wcd-detail-sig" />;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;

  if (Array.isArray(value)) {
    const first = value[0];
    // Checklist rows (e.g. hazard walk-through, toolbox talk lines): { check, answer, comment }
    if (first && typeof first === "object" && "check" in first) {
      const answered = value.filter((row) => row.answer || row.comment);
      if (!answered.length) return <span className="wcd-detail-empty">Nothing ticked</span>;
      return (
        <div className="wcd-detail-checklist">
          {answered.map((row, i) => (
            <div key={i} className={`wcd-detail-check-row ${row.answer || ""}`}>
              <span className="wcd-detail-check-text">{row.ref ? `${row.ref} — ` : ""}{row.check}</span>
              <span className={`wcd-detail-check-badge ${row.answer || ""}`}>{row.answer ? row.answer.toUpperCase() : "—"}</span>
              {row.comment ? <span className="wcd-detail-check-comment">{row.comment}</span> : null}
            </div>
          ))}
        </div>
      );
    }
    // Dynamic table rows (crew sign-on, task steps, residual risk, etc.)
    if (first && typeof first === "object") {
      const cols = Object.keys(first);
      const rows = value.filter((row) => Object.values(row).some((v) => !isBlank(v)));
      if (!rows.length) return <span className="wcd-detail-empty">—</span>;
      return (
        <div className="wcd-detail-tbl-wrap">
          <table className="wcd-detail-tbl">
            <thead><tr>{cols.map((c) => <th key={c}>{humanizeKey(c)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c}>
                      {isSignatureValue(row[c])
                        ? <img src={row[c]} alt="Signature" className="wcd-detail-sig-sm" />
                        : (isBlank(row[c]) ? "—" : String(row[c]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    // Array of plain values
    return <span>{value.join(", ")}</span>;
  }

  if (typeof value === "object") {
    // Boolean-map objects (e.g. PPE selections): show only what's checked
    const checked = Object.entries(value).filter(([, v]) => v);
    if (!checked.length) return <span className="wcd-detail-empty">None selected</span>;
    return <span>{checked.map(([k]) => humanizeKey(k)).join(", ")}</span>;
  }

  return <span>{String(value)}</span>;
}

function SubmittedFormViewer({ details }) {
  const [open, setOpen] = useState(false);
  if (!details || typeof details !== "object") {
    return <p className="wcd-detail-empty">No submitted details recorded for this entry.</p>;
  }
  const entries = Object.entries(details).filter(([, value]) => !isBlank(value));
  return (
    <div className="wcd-detail-section">
      <button type="button" className="wcd-detail-toggle" onClick={() => setOpen((o) => !o)}>
        <FileText size={14} /> {open ? "Hide" : "View"} submitted form ({entries.length} field{entries.length === 1 ? "" : "s"} recorded)
      </button>
      {open ? (
        entries.length ? (
          <div className="wcd-detail-grid">
            {entries.map(([key, value]) => (
              <div key={key} className="wcd-detail-row">
                <span className="wcd-detail-label">{humanizeKey(key)}</span>
                <div className="wcd-detail-value"><DetailValue value={value} /></div>
              </div>
            ))}
          </div>
        ) : (
          <p className="wcd-detail-empty">No details were recorded on this submission.</p>
        )
      ) : null}
    </div>
  );
}

export default function WhsComplianceDashboard() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [forms, setForms] = useState([]);
  const [error, setError] = useState("");
  const [auditing, setAuditing] = useState(null); // form being audited
  const [audit, setAudit] = useState({ outcome: "pass", checks: [], findings: "", corrective_action: "", corrective_due: "" });

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session?.access_token]);

  const load = useCallback(async () => {
    try {
      const [cRes, fRes] = await Promise.all([
        authFetch("GET", "/api/whs-compliance"),
        authFetch("GET", "/api/whs-forms"),
      ]);
      const cData = await cRes.json(); const fData = await fRes.json();
      if (!cRes.ok) throw new Error(cData.error);
      setData(cData); setForms(fData.forms || []);
    } catch (e) { setError(e.message); }
  }, [authFetch]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  const openAudit = (f) => {
    setAuditing(f);
    setAudit({ outcome: "pass", checks: DEFAULT_CHECKS.map((label) => ({ label, status: "pass" })), findings: "", corrective_action: "", corrective_due: "" });
  };
  const setCheck = (i, status) => setAudit((a) => ({ ...a, checks: a.checks.map((c, j) => j === i ? { ...c, status } : c) }));

  const submitAudit = async () => {
    try {
      const res = await authFetch("POST", "/api/whs-audits", { form_id: auditing.id, ...audit });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      setAuditing(null); await load();
    } catch (e) { setError(e.message); }
  };

  const closeAction = async (audit_id) => {
    try { const res = await authFetch("PATCH", "/api/whs-audits", { audit_id, corrective_status: "closed" }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(); } catch (e) { setError(e.message); }
  };

  if (error) return <p className="wcd-error"><AlertCircle size={15} /> {error}</p>;
  if (!data) return <p className="wcd-loading">Loading compliance dashboard…</p>;

  const maxForm = Math.max(1, ...Object.values(data.byForm));

  return (
    <div className="wcd">
      <style>{WCD_DETAIL_CSS}</style>
      {/* Top metric row */}
      <div className="wcd-top">
        <div className="wcd-gauge-card">
          <Gauge pct={data.overall} />
          <div className="wcd-gauge-side">
            <div className="wcd-gauge-title">Overall compliance</div>
            <div className="wcd-gauge-sub">{data.passed} passed · {data.failed} failed of {data.totals.audited} audited</div>
          </div>
        </div>
        <div className="wcd-metrics">
          <div className="wcd-metric"><div className="wcd-metric-v">{data.totals.submitted}</div><div className="wcd-metric-l">Submitted</div></div>
          <div className="wcd-metric"><div className="wcd-metric-v" style={{ color: data.totals.awaiting ? "#a5772b" : "#2c6a34" }}>{data.totals.awaiting}</div><div className="wcd-metric-l">Awaiting review</div></div>
          <div className="wcd-metric"><div className="wcd-metric-v" style={{ color: data.totals.failedChecks ? "#a5342a" : "#2c6a34" }}>{data.totals.failedChecks}</div><div className="wcd-metric-l">Failed checks</div></div>
          <div className="wcd-metric"><div className="wcd-metric-v">{data.medianReviewHours == null ? "—" : data.medianReviewHours + "h"}</div><div className="wcd-metric-l">Median review time</div></div>
        </div>
      </div>

      {/* Breakdowns */}
      <div className="wcd-cols">
        <div className="wcd-panel">
          <h3>Submissions by form</h3>
          {Object.keys(data.byForm).length ? Object.entries(data.byForm).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} className="wcd-bar-row">
              <span className="wcd-bar-lbl">{k}</span>
              <span className="wcd-bar-track"><span className="wcd-bar-fill" style={{ width: `${(v / maxForm) * 100}%` }} /></span>
              <span className="wcd-bar-num">{v}</span>
            </div>
          )) : <p className="wcd-empty">No submissions yet.</p>}
        </div>
        <div className="wcd-panel">
          <h3>Review status</h3>
          {Object.entries(data.reviewStatus).map(([k, v]) => (
            <div key={k} className="wcd-status-row"><span className={`wcd-dot ${k}`} /><span className="wcd-status-lbl">{k}</span><span className="wcd-status-num">{v}</span></div>
          ))}
        </div>
      </div>

      {/* Where checks are failing */}
      {Object.keys(data.failedByCat).length > 0 && (
        <div className="wcd-panel">
          <h3><AlertTriangle size={15} /> Where checks are failing</h3>
          {Object.entries(data.failedByCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} className="wcd-fail-row"><span>{k}</span><span className="wcd-fail-num">{v}</span></div>
          ))}
        </div>
      )}

      {/* Open corrective actions */}
      {data.openActions.length > 0 && (
        <div className="wcd-panel">
          <h3><Clock size={15} /> Open corrective actions</h3>
          {data.openActions.map((a) => (
            <div key={a.audit_id} className="wcd-action-row">
              <div><div className="wcd-action-title">{a.form_title}</div><div className="wcd-action-desc">{a.corrective_action}{a.due ? ` · due ${new Date(a.due).toLocaleDateString("en-AU")}` : ""}</div></div>
              <button className="wcd-close-btn" onClick={() => closeAction(a.audit_id)}>Close</button>
            </div>
          ))}
        </div>
      )}

      {/* Submitted forms register */}
      <div className="wcd-panel">
        <h3><FileText size={15} /> Submitted forms register</h3>
        {forms.length ? (
          <div className="wcd-register">
            {forms.map((f) => (
              <div key={f.id} className="wcd-reg-row">
                <div className="wcd-reg-main">
                  <div className="wcd-reg-title">{f.title}{f.notifiable_flag ? <span className="wcd-notif">Notifiable?</span> : null}</div>
                  <div className="wcd-reg-meta">{TYPE_LABEL[f.form_type] || f.form_type} · {f.author || "Unknown"}{f.site ? ` · ${f.site}` : ""} · {new Date(f.created_at).toLocaleDateString("en-AU")}</div>
                </div>
                <span className={`wcd-reg-status ${f.status}`}>{f.status}</span>
                <button className="wcd-audit-btn" onClick={() => openAudit(f)}><ClipboardCheck size={13} /> Audit</button>
              </div>
            ))}
          </div>
        ) : <p className="wcd-empty">Register empty — no forms submitted yet.</p>}
      </div>

      {/* Audit modal */}
      {auditing && (
        <div className="wcd-modal-bg" onClick={() => setAuditing(null)}>
          <div className="wcd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wcd-modal-head">
              <div><div className="wcd-modal-eyebrow">Compliance audit</div><h2>{auditing.title}</h2></div>
              <button onClick={() => setAuditing(null)}><X size={18} /></button>
            </div>

            <SubmittedFormViewer details={auditing.details} />

            <label className="wcd-f"><span>Audit outcome</span>
              <select value={audit.outcome} onChange={(e) => setAudit({ ...audit, outcome: e.target.value })}>
                <option value="pass">Pass</option>
                <option value="pass_with_actions">Pass with corrective actions</option>
                <option value="fail">Fail</option>
              </select>
            </label>

            <div className="wcd-checks">
              <span className="wcd-checks-lbl">Compliance checks</span>
              {audit.checks.map((c, i) => (
                <div key={i} className="wcd-check-row">
                  <span>{c.label}</span>
                  <div className="wcd-check-btns">
                    {["pass", "fail", "na"].map((s) => (
                      <button key={s} className={`wcd-check-btn ${c.status === s ? "sel " + s : ""}`} onClick={() => setCheck(i, s)}>{s === "na" ? "N/A" : s}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <label className="wcd-f"><span>Findings</span><textarea rows={2} value={audit.findings} onChange={(e) => setAudit({ ...audit, findings: e.target.value })} /></label>
            {audit.outcome !== "pass" && (
              <>
                <label className="wcd-f"><span>Corrective action</span><textarea rows={2} value={audit.corrective_action} onChange={(e) => setAudit({ ...audit, corrective_action: e.target.value })} /></label>
                <label className="wcd-f"><span>Corrective action due</span><input type="date" value={audit.corrective_due} onChange={(e) => setAudit({ ...audit, corrective_due: e.target.value })} /></label>
              </>
            )}

            <div className="wcd-modal-actions">
              <button className="wcd-record" onClick={submitAudit}><CheckCircle2 size={15} /> Record audit</button>
              <button className="wcd-cancel" onClick={() => setAuditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Scoped styles for the submitted-form viewer only — kept local rather than
   added to app/globals.css, which multiple sessions have been editing this
   week; the rest of this component's .wcd-* classes already exist there. */
const WCD_DETAIL_CSS = `
.wcd-detail-section { margin: -4px 0 16px; }
.wcd-detail-toggle { display: inline-flex; align-items: center; gap: 7px; background: #eef6ea; border: 1px solid #b9d5a6; color: #2c6a34; border-radius: 8px; padding: 8px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; margin-bottom: 12px; }
.wcd-detail-toggle:hover { background: #e3edd6; }
.wcd-detail-grid { display: flex; flex-direction: column; gap: 10px; max-height: 360px; overflow-y: auto; border: 1px solid #eef0e9; border-radius: 10px; padding: 12px 14px; background: #fafaf5; margin-bottom: 4px; }
.wcd-detail-row { display: flex; flex-direction: column; gap: 3px; padding-bottom: 9px; border-bottom: 1px solid #f0ece2; }
.wcd-detail-row:last-child { border-bottom: none; padding-bottom: 0; }
.wcd-detail-label { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: #5c6b52; }
.wcd-detail-value { font-size: 13px; color: #23301f; line-height: 1.5; }
.wcd-detail-empty { color: #b0b8a8; font-style: italic; font-size: 12.5px; }
.wcd-detail-sig { max-width: 220px; max-height: 90px; border: 1px solid #e3e6d8; border-radius: 6px; background: #fff; }
.wcd-detail-sig-sm { max-width: 90px; max-height: 40px; border: 1px solid #e3e6d8; border-radius: 4px; background: #fff; }
.wcd-detail-checklist { display: flex; flex-direction: column; gap: 6px; }
.wcd-detail-check-row { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; }
.wcd-detail-check-text { flex: 1; color: #3a4740; }
.wcd-detail-check-badge { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; padding: 2px 7px; border-radius: 5px; background: #eef0e9; color: #6b755f; flex-shrink: 0; }
.wcd-detail-check-badge.yes { background: #e5f1dd; color: #2c6a34; }
.wcd-detail-check-badge.no { background: #fbecea; color: #a5342a; }
.wcd-detail-check-badge.na { background: #eef0e9; color: #5c6b52; }
.wcd-detail-check-comment { flex-basis: 100%; font-size: 11.5px; color: #7a877d; font-style: italic; padding-left: 4px; }
.wcd-detail-tbl-wrap { overflow-x: auto; }
.wcd-detail-tbl { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.wcd-detail-tbl th { text-align: left; font-family: 'IBM Plex Mono', monospace; font-size: 9px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: #5c6b52; padding: 5px 7px; border-bottom: 1px solid #e3e6d8; white-space: nowrap; }
.wcd-detail-tbl td { padding: 5px 7px; border-bottom: 1px solid #f0ece2; color: #3a4740; }
`;
