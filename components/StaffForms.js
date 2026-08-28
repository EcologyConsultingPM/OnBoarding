"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CalendarDays, GraduationCap, Package, Send, CheckCircle2, AlertCircle,
  ShieldAlert, AlertTriangle, Route, ClipboardCheck, MapPin, FileWarning, Building2,
  History, ChevronLeft, HeartPulse, ListChecks,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import { FORM_SCHEMAS, FORM_GROUPS } from "../lib/formSchemas";
import { CARD_META } from "../lib/formCardMeta";
import SignaturePad from "./SignaturePad";
import WorkspaceNav from "./WorkspaceNav";

const ICONS = {
  leave: CalendarDays, training: GraduationCap, equipment: Package,
  daily_risk_assessment: ClipboardCheck, journey_plan: Route, pre_mobilisation: ClipboardCheck, site_erp: MapPin,
  injury_incident: AlertTriangle, near_miss: ShieldAlert, office_risk_assessment: Building2,
  job_safety_analysis: ListChecks, first_aid_kit: HeartPulse, hazard_report: FileWarning,
};
const BLURBS = {
  leave: "Annual, personal, or other leave.", training: "Courses, conferences, accreditation.",
  equipment: "Field gear, PPE, IT or other equipment.",
  daily_risk_assessment: "Conditions, hazards, check-in & crew sign-on.",
  journey_plan: "Crew, route, monitoring & overdue escalation.",
  pre_mobilisation: "Vehicle, comms, approvals before departure.",
  site_erp: "Access, medical, muster & evacuation.",
  injury_incident: "Record an injury, illness or dangerous incident.",
  office_risk_assessment: "Office hazards, controls & actions.",
  job_safety_analysis: "Step-by-step task hazard analysis.",
  first_aid_kit: "Vehicle, field & office kit checks.",
};

const WHS_DEFINITIONS = {
  injury_incident: {
    title: "What counts as a notifiable incident",
    body: "Under the model WHS Act, a notifiable incident is the death of a person, a serious injury or illness (e.g. requiring immediate in-patient hospital treatment, or immediate treatment for a serious injury), or a dangerous incident that exposes any person to a serious risk - even if no one is hurt. The test is objective. A PCBU must notify the regulator immediately of a notifiable incident.",
  },
};

const STATUS_STYLE = {
  submitted: { bg: "#fbf1dd", fg: "#a5772b", label: "Submitted" },
  approved: { bg: "#e5f1dd", fg: "#2c6a34", label: "Approved" },
  declined: { bg: "#fbecea", fg: "#a5342a", label: "Declined" },
  cancelled: { bg: "#eef0e9", fg: "#6b755f", label: "Cancelled" },
  reviewed: { bg: "#e3edf5", fg: "#2a6591", label: "Reviewed" },
  actioned: { bg: "#e5f1dd", fg: "#2c6a34", label: "Actioned" },
  archived: { bg: "#eef0e9", fg: "#6b755f", label: "Archived" },
};

export default function StaffForms() {
  const { session } = useAuth();
  const [view, setView] = useState("hub");
  const [activeKey, setActiveKey] = useState(null);
  const [form, setForm] = useState({});
  const [requests, setRequests] = useState([]);
  const [whsHistory, setWhsHistory] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const loadHistory = useCallback(async () => {
    try {
      const [rRes, wRes] = await Promise.all([
        authFetch("GET", "/api/service-requests"),
        authFetch("GET", "/api/whs-forms"),
      ]);
      const rData = await rRes.json(); const wData = await wRes.json();
      if (rRes.ok) setRequests(rData.requests || []);
      if (wRes.ok) setWhsHistory(wData.forms || []);
    } catch (e) { setError(e.message); }
  }, [authFetch]);

  useEffect(() => { if (session?.access_token) loadHistory(); }, [session, loadHistory]);

  const notify = (m) => { setMessage(m); setError(""); setTimeout(() => setMessage(""), 2600); };
  const openForm = (key) => { setActiveKey(key); setForm({}); setError(""); setView("form"); };
  const backToHub = () => { setView("hub"); setActiveKey(null); setForm({}); };
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }));

  const schema = activeKey ? FORM_SCHEMAS[activeKey] : null;

  const submit = async () => {
    setError("");
    if (!schema) return;
    // Title: first text field value, else form label.
    const firstText = schema.sections.flatMap((s) => s.fields).find((f) => ["text"].includes(f[2]));
    const title = (form[firstText?.[0]] || schema.label).toString().trim();

    if (schema.kind === "request") {
      try {
        const res = await authFetch("POST", "/api/service-requests", { request_type: activeKey, title: `${schema.label}: ${title}`, details: form });
        const d = await res.json(); if (!res.ok) throw new Error(d.error);
        backToHub(); await loadHistory(); notify("Request submitted for approval.");
      } catch (e) { setError(e.message); }
      return;
    }
    try {
      const res = await authFetch("POST", "/api/whs-forms", {
        form_type: activeKey, title: `${schema.label}: ${title}`,
        site: form.site || form.location || form.siteName || "", form_date: form.date || null,
        notifiable_flag: !!form.notifiable_flag, details: form,
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      backToHub(); await loadHistory();
      notify(activeKey === "injury_incident" ? "Submitted - a copy has gone to admin for review." : "Submitted and saved to your history.");
    } catch (e) { setError(e.message); }
  };

  const cancel = async (id) => {
    if (!window.confirm("Cancel this request?")) return;
    try { const res = await authFetch("PATCH", "/api/service-requests/" + id, { action: "cancel" }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await loadHistory(); } catch (e) { setError(e.message); }
  };

  const renderField = ([key, label, type]) => {
    if (type === "signature") return <SignaturePad key={key} label={label} value={form[key] || ""} onChange={(v) => set(key, v)} />;
    if (type === "checkbox") return (
      <label key={key} className="sf-field sf-full sf-check"><input type="checkbox" checked={!!form[key]} onChange={(e) => set(key, e.target.checked)} /><span>{label}</span></label>
    );
    let input;
    if (type === "textarea") input = <textarea rows={2} value={form[key] || ""} onChange={(e) => set(key, e.target.value)} />;
    else if (type === "date") input = <input type="date" value={form[key] || ""} onChange={(e) => set(key, e.target.value)} />;
    else if (type === "time") input = <input type="time" value={form[key] || ""} onChange={(e) => set(key, e.target.value)} />;
    else if (type === "number") input = <input type="number" value={form[key] || ""} onChange={(e) => set(key, e.target.value)} />;
    else if (type && type.startsWith("select:")) input = (
      <select value={form[key] || ""} onChange={(e) => set(key, e.target.value)}>
        <option value="">Select...</option>
        {type.slice(7).split(",").map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    else input = <input value={form[key] || ""} onChange={(e) => set(key, e.target.value)} />;
    const wide = type === "textarea";
    return <label key={key} className={"sf-field" + (wide ? " sf-full" : "")}><span>{label}</span>{input}</label>;
  };

  // ---------- HISTORY ----------
  if (view === "history") {
    const all = [
      ...requests.map((r) => ({ id: r.id, when: r.created_at, title: r.title, kind: r.request_type, status: r.status, note: r.admin_note, cancelable: r.status === "submitted" })),
      ...whsHistory.map((w) => ({ id: w.id, when: w.created_at, title: w.title, kind: w.form_type.replace(/_/g, " "), status: w.status, note: w.review_note, cancelable: false })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when));
    return (
      <div className="sf">
        <header className="sf-hero"><span>Ecology Consulting - Your records</span><h1>Submission history</h1><p>Every form and request you have submitted, with its current status. This record stays in your portal.</p></header>
        <button className="sf-back" onClick={() => setView("hub")}><ChevronLeft size={15} /> Back to forms</button>
        {all.length ? (
          <div className="sf-list">
            {all.map((r) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.submitted;
              return (
                <div key={r.id} className="sf-row">
                  <div className="sf-row-main"><div className="sf-row-title">{r.title}</div><div className="sf-row-meta">{r.kind} - {new Date(r.when).toLocaleDateString("en-AU")}{r.note ? " - " + r.note : ""}</div></div>
                  <span className="sf-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  {r.cancelable ? <button className="sf-row-cancel" onClick={() => cancel(r.id)}>Cancel</button> : null}
                </div>
              );
            })}
          </div>
        ) : <p className="sf-empty">Nothing submitted yet.</p>}
      </div>
    );
  }

  // ---------- A FORM ----------
  if (view === "form" && schema) {
    const def = WHS_DEFINITIONS[activeKey];
    return (
      <div className="sf">
        <header className="sf-hero"><span>Ecology Consulting - {schema.kind === "request" ? "Staff services" : "WHS field form"}</span><h1>{schema.label}</h1><p>{BLURBS[activeKey] || ""}</p></header>
        <button className="sf-back" onClick={backToHub}><ChevronLeft size={15} /> Back to forms</button>
        {def ? <div className="sf-legis"><ShieldAlert size={16} /><div><strong>{def.title}</strong><p>{def.body}</p><span className="sf-legis-note">This summarises the model WHS Act. Follow your jurisdiction regulator and EC WHS procedures. If in doubt, notify your supervisor immediately.</span></div></div> : null}
        {error ? <p className="sf-error"><AlertCircle size={15} /> {error}</p> : null}

        <div className="sf-form">
          {schema.sections.map((sec) => (
            <div key={sec.title} className="sf-section">
              <div className="sf-section-title">{sec.title}</div>
              <div className="sf-grid">{sec.fields.map(renderField)}</div>
            </div>
          ))}
          <div className="sf-actions">
            <button className="sf-submit" onClick={submit}><Send size={14} /> Submit</button>
            <button className="sf-cancel" onClick={backToHub}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- HUB ----------
  const byGroup = FORM_GROUPS.map((g) => ({
    label: g,
    forms: Object.entries(FORM_SCHEMAS).filter(([, s]) => s.group === g).map(([key, s]) => ({ key, label: s.label, kind: s.kind })),
  }));

  return (
    <div className="sf">
      <header className="sf-hero"><WorkspaceNav audience="staff" /><span>Ecology Consulting - Staff services</span><h1>WHS &amp; EC Forms</h1><p>Field forms, WHS reports and staff requests - all in one place. Submissions are saved to your history; requests and incidents route to admin for review.</p></header>
      {error ? <p className="sf-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="sf-success"><CheckCircle2 size={15} /> {message}</p> : null}
      <button className="sf-history-btn" onClick={() => setView("history")}><History size={15} /> View my submission history</button>

      {byGroup.map((g) => (
        <section key={g.label} className="sf-group">
          <div className="sf-group-label">{g.label}</div>
          <div className="sf-cards">
            {g.forms.map((f) => {
              const m = CARD_META[f.key] || {};
              return (
                <button key={f.key} className="sf-card" onClick={() => openForm(f.key)}>
                  <div className="sf-card-photo" style={{ backgroundImage: `url('/assets/${m.photo || "wattle"}.png')` }}>
                    <div className="sf-card-code">{m.code || ""}{m.rev ? ` · ${m.rev}` : ""}</div>
                    <div className="sf-card-title">{f.label}</div>
                  </div>
                  <div className="sf-card-body">
                    <p className="sf-card-desc">{m.desc || BLURBS[f.key] || ""}</p>
                    <div className="sf-card-foot">
                      <span className="sf-card-pill">{m.status || "READY"}</span>
                      <span className="sf-card-open">OPEN FORM →</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sf-doc-control">
        <div className="sf-doc-control-label">Document control</div>
        <p>Complete on screen, sign with your finger, then press <strong>Submit form</strong>. The submitted copy — signatures and all — lands in <strong>Admin › WHS Monitoring</strong>, where it's recorded for the compliance audit. Never edit a controlled template — request a revision through the admin portal.</p>
      </div>
    </div>
  );
}
