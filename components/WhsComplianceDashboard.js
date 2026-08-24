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
  }), [session]);

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
