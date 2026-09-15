"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardList, AlertTriangle, ShieldAlert, CheckCircle2, AlertCircle, Filter } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const TYPE_LABEL = {
  daily_risk_assessment: "Daily Risk Assessment",
  office_risk_assessment: "Office Risk Assessment",
  injury_incident: "Injury / Incident",
  near_miss: "Near Miss / Dangerous Incident",
  site_erp: "Site Specific ERP",
  journey_plan: "Journey Management Plan",
  pre_mobilisation: "Pre-Mobilisation Check",
  toolbox_talk: "Toolbox Talk",
  hazard_report: "Hazard Report",
};

const STATUS_STYLE = {
  submitted: { bg: "#fbf1dd", fg: "#a5772b", label: "Submitted" },
  reviewed: { bg: "#e3edf5", fg: "#2a6591", label: "Reviewed" },
  actioned: { bg: "#e5f1dd", fg: "#2c6a34", label: "Actioned" },
  archived: { bg: "#eef0e9", fg: "#6b755f", label: "Archived" },
};

export default function WhsFormsCompliance() {
  const { session } = useAuth();
  const [forms, setForms] = useState([]);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState("");

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session?.access_token]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("GET", "/api/whs-forms");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForms(data.forms || []);
    } catch (e) { setError(e.message); }
  }, [authFetch]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  const act = async (id, action) => {
    try {
      const res = await authFetch("PATCH", `/api/whs-forms/${id}`, { action, review_note: note });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      setOpenId(null); setNote(""); await load();
    } catch (e) { setError(e.message); }
  };

  const visible = forms.filter((f) =>
    (typeFilter === "all" || f.form_type === typeFilter) &&
    (statusFilter === "all" || f.status === statusFilter)
  );

  const notifiableCount = forms.filter((f) => f.notifiable_flag).length;
  const awaiting = forms.filter((f) => f.status === "submitted").length;

  return (
    <div className="wfc">
      <div className="wfc-head">
        <h2><ClipboardList size={17} /> WHS form submissions</h2>
        <p>Every field form and WHS report staff submit, for compliance auditing. Review, action, and flag notifiable incidents.</p>
      </div>

      <div className="wfc-summary">
        <div className="wfc-sum"><div className="wfc-sum-v">{forms.length}</div><div className="wfc-sum-l">Total submissions</div></div>
        <div className="wfc-sum"><div className="wfc-sum-v" style={{ color: awaiting ? "#a5772b" : "#2c6a34" }}>{awaiting}</div><div className="wfc-sum-l">Awaiting review</div></div>
        <div className="wfc-sum"><div className="wfc-sum-v" style={{ color: notifiableCount ? "#a5342a" : "#2c6a34" }}>{notifiableCount}</div><div className="wfc-sum-l">Flagged notifiable</div></div>
      </div>

      {error ? <p className="wfc-error"><AlertCircle size={15} /> {error}</p> : null}

      <div className="wfc-controls">
        <Filter size={14} />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All form types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="submitted">Awaiting review</option>
          <option value="reviewed">Reviewed</option>
          <option value="actioned">Actioned</option>
          <option value="archived">Archived</option>
        </select>
        <span className="wfc-count">{visible.length} shown</span>
      </div>

      <div className="wfc-list">
        {visible.length ? visible.map((f) => {
          const st = STATUS_STYLE[f.status] || STATUS_STYLE.submitted;
          const details = Object.entries(f.details || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");
          return (
            <div key={f.id} className={`wfc-card ${f.notifiable_flag ? "notifiable" : ""}`}>
              <div className="wfc-card-top">
                <div>
                  <div className="wfc-title">
                    {(f.form_type === "injury_incident" || f.form_type === "near_miss") && <AlertTriangle size={14} style={{ verticalAlign: "-2px", marginRight: 5, color: "#a5342a" }} />}
                    {f.title}
                    {f.notifiable_flag && <span className="wfc-notif"><ShieldAlert size={11} /> Possibly notifiable</span>}
                  </div>
                  <div className="wfc-meta">{TYPE_LABEL[f.form_type] || f.form_type} · {f.author || "Unknown"}{f.site ? ` · ${f.site}` : ""} · {new Date(f.created_at).toLocaleDateString("en-AU")}</div>
                </div>
                <span className="wfc-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              </div>
              {details ? <div className="wfc-detail">{details}</div> : null}
              {f.review_note ? <div className="wfc-note">Review: {f.review_note}</div> : null}

              {openId === f.id ? (
                <div className="wfc-review">
                  <input placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="wfc-btn rev" onClick={() => act(f.id, "reviewed")}>Mark reviewed</button>
                  <button className="wfc-btn act" onClick={() => act(f.id, "actioned")}>Actioned</button>
                  <button className="wfc-btn arch" onClick={() => act(f.id, "archived")}>Archive</button>
                  <button className="wfc-btn cancel" onClick={() => { setOpenId(null); setNote(""); }}>Back</button>
                </div>
              ) : (
                f.status !== "archived" && <button className="wfc-review-btn" onClick={() => { setOpenId(f.id); setNote(f.review_note || ""); }}>Review</button>
              )}
            </div>
          );
        }) : <p className="wfc-empty">No submissions match this filter.</p>}
      </div>
    </div>
  );
}
