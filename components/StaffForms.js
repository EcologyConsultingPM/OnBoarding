"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CalendarDays, GraduationCap, Package, Send, CheckCircle2, AlertCircle, X,
  ShieldAlert, AlertTriangle, Route, ClipboardCheck, MapPin, FileWarning, Building2, History, ChevronLeft,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const GROUPS = [
  {
    label: "Staff & HR",
    forms: [
      { key: "leave", kind: "request", label: "Leave Request", Icon: CalendarDays, blurb: "Annual, personal, or other leave." },
      { key: "training", kind: "request", label: "Training Request", Icon: GraduationCap, blurb: "Courses, conferences, accreditation." },
      { key: "equipment", kind: "request", label: "Equipment Request", Icon: Package, blurb: "Field gear, PPE, IT or other equipment." },
    ],
  },
  {
    label: "Field & mobilisation",
    forms: [
      { key: "daily_risk_assessment", kind: "whs", label: "Daily Risk Assessment", Icon: ClipboardCheck, blurb: "Conditions on arrival, hazard walk-through, stop-work triggers." },
      { key: "journey_plan", kind: "whs", label: "Journey Management Plan", Icon: Route, blurb: "Crew manifest, route legs, check-in & overdue escalation." },
      { key: "pre_mobilisation", kind: "whs", label: "Pre-Mobilisation Check", Icon: ClipboardCheck, blurb: "Approvals, scope, access, equipment & competency." },
      { key: "site_erp", kind: "whs", label: "Site Specific ERP", Icon: MapPin, blurb: "Access, contacts, muster points & scenario response cards." },
    ],
  },
  {
    label: "WHS & office",
    forms: [
      { key: "injury_incident", kind: "whs", label: "Injury / Incident Report", Icon: AlertTriangle, blurb: "Record a workplace injury or illness." },
      { key: "near_miss", kind: "whs", label: "Near Miss / Dangerous Incident", Icon: ShieldAlert, blurb: "Report a dangerous incident - even if no one was hurt." },
      { key: "office_risk_assessment", kind: "whs", label: "Office Risk Assessment", Icon: Building2, blurb: "Assess office-based hazards and controls." },
      { key: "hazard_report", kind: "whs", label: "Hazard Report", Icon: FileWarning, blurb: "Flag a hazard for attention." },
    ],
  },
];

const WHS_DEFINITIONS = {
  injury_incident: {
    title: "What counts as a notifiable serious injury or illness",
    body: "Under the model WHS Act, a serious injury or illness generally means one requiring immediate treatment as an in-patient in a hospital, or immediate treatment for a serious injury (e.g. amputation, serious head or eye injury, serious burn, spinal injury, degloving/scalping, loss of a bodily function, serious laceration), or medical treatment within 48 hours of exposure to a substance. The test is objective - the nature of the injury, not your personal judgement of severity. A PCBU must notify the regulator immediately of a notifiable incident.",
  },
  near_miss: {
    title: "What counts as a dangerous incident (near miss)",
    body: "Under the model WHS Act, a dangerous incident is one that exposes any person to a serious risk to their health or safety from an immediate or imminent exposure - even if no one is injured. Examples include uncontrolled escape/spillage/leakage of a substance, uncontrolled fire or explosion, electric shock, or the fall or release of a load from height. If the potential for serious harm was present, it must be reported. Notifiable dangerous incidents must be reported to the regulator immediately.",
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
  const [active, setActive] = useState(null);
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
  const openForm = (f) => { setActive(f); setForm({}); setError(""); setView("form"); };
  const backToHub = () => { setView("hub"); setActive(null); setForm({}); };
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }));

  const submit = async () => {
    setError("");
    const f = active;
    if (f.kind === "request") {
      let title = "", details = {};
      if (f.key === "leave") {
        if (!form.leaveType || !form.startDate || !form.endDate) { setError("Leave type, start and end dates are required."); return; }
        title = form.leaveType + " leave - " + form.startDate + " to " + form.endDate;
        details = { leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate, reason: form.reason || "" };
      } else if (f.key === "training") {
        if (!form.course || !form.provider) { setError("Course and provider are required."); return; }
        title = "Training: " + form.course;
        details = { course: form.course, provider: form.provider, cost: form.cost || "", date: form.date || "", justification: form.justification || "" };
      } else {
        if (!form.item) { setError("Item is required."); return; }
        title = "Equipment: " + form.item;
        details = { item: form.item, quantity: form.quantity || "1", reason: form.reason || "", neededBy: form.neededBy || "" };
      }
      try {
        const res = await authFetch("POST", "/api/service-requests", { request_type: f.key, title, details });
        const d = await res.json(); if (!res.ok) throw new Error(d.error);
        backToHub(); await loadHistory(); notify("Request submitted for approval.");
      } catch (e) { setError(e.message); }
      return;
    }
    const title = (form.title || f.label).toString().trim();
    if (title.length < 2) { setError("Enter a short title/description."); return; }
    const rest = { ...form };
    delete rest.title; delete rest.site; delete rest.form_date; delete rest.notifiable_flag;
    try {
      const res = await authFetch("POST", "/api/whs-forms", {
        form_type: f.key, title, site: form.site || "", form_date: form.form_date || null,
        notifiable_flag: !!form.notifiable_flag, details: rest,
      });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      backToHub(); await loadHistory();
      notify(["injury_incident", "near_miss"].includes(f.key) ? "Submitted - a copy has gone to admin for review." : "Submitted and saved to your history.");
    } catch (e) { setError(e.message); }
  };

  const cancel = async (id) => {
    if (!window.confirm("Cancel this request?")) return;
    try { const res = await authFetch("PATCH", "/api/service-requests/" + id, { action: "cancel" }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await loadHistory(); } catch (e) { setError(e.message); }
  };

  const fld = (label, node) => <label className="sf-field"><span>{label}</span>{node}</label>;

  if (view === "history") {
    const all = [
      ...requests.map((r) => ({ id: r.id, when: r.created_at, title: r.title, kind: r.request_type, status: r.status, note: r.admin_note, cancelable: r.status === "submitted" })),
      ...whsHistory.map((w) => ({ id: w.id, when: w.created_at, title: w.title, kind: w.form_type.replace(/_/g, " "), status: w.status, note: w.review_note, cancelable: false })),
    ].sort((a, b) => new Date(b.when) - new Date(a.when));
    return (
      <div className="sf">
        <header className="sf-hero">
          <span>Ecology Consulting - Your records</span>
          <h1>Submission history</h1>
          <p>Every form and request you have submitted, with its current status. This record stays in your portal.</p>
        </header>
        <button className="sf-back" onClick={() => setView("hub")}><ChevronLeft size={15} /> Back to forms</button>
        {all.length ? (
          <div className="sf-list">
            {all.map((r) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.submitted;
              return (
                <div key={r.id} className="sf-row">
                  <div className="sf-row-main">
                    <div className="sf-row-title">{r.title}</div>
                    <div className="sf-row-meta">{r.kind} - {new Date(r.when).toLocaleDateString("en-AU")}{r.note ? " - " + r.note : ""}</div>
                  </div>
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

  if (view === "form" && active) {
    const def = WHS_DEFINITIONS[active.key];
    return (
      <div className="sf">
        <header className="sf-hero">
          <span>Ecology Consulting - {active.kind === "request" ? "Staff services" : "WHS field form"}</span>
          <h1>{active.label}</h1>
          <p>{active.blurb}</p>
        </header>
        <button className="sf-back" onClick={backToHub}><ChevronLeft size={15} /> Back to forms</button>

        {def ? (
          <div className="sf-legis"><ShieldAlert size={16} /><div><strong>{def.title}</strong><p>{def.body}</p><span className="sf-legis-note">This guidance summarises the model WHS Act. Always follow your jurisdiction regulator and EC WHS procedures. If in doubt, notify your supervisor immediately.</span></div></div>
        ) : null}

        {error ? <p className="sf-error"><AlertCircle size={15} /> {error}</p> : null}

        <div className="sf-form">
          {active.kind === "whs" && (
            <div className="sf-grid">
              {fld("Title / short description", <input value={form.title || ""} onChange={(e) => set("title", e.target.value)} placeholder={active.label} />)}
              {fld("Site / location", <input value={form.site || ""} onChange={(e) => set("site", e.target.value)} />)}
              {fld("Date", <input type="date" value={form.form_date || ""} onChange={(e) => set("form_date", e.target.value)} />)}
            </div>
          )}

          {active.key === "leave" && (
            <div className="sf-grid">
              {fld("Leave type", <select value={form.leaveType || ""} onChange={(e) => set("leaveType", e.target.value)}><option value="">Select...</option>{["Annual","Personal / carer's","Compassionate","Long service","Unpaid","Other"].map((o) => <option key={o}>{o}</option>)}</select>)}
              {fld("Start date", <input type="date" value={form.startDate || ""} onChange={(e) => set("startDate", e.target.value)} />)}
              {fld("End date", <input type="date" value={form.endDate || ""} onChange={(e) => set("endDate", e.target.value)} />)}
              {fld("Reason (optional)", <textarea rows={2} value={form.reason || ""} onChange={(e) => set("reason", e.target.value)} />)}
            </div>
          )}
          {active.key === "training" && (
            <div className="sf-grid">
              {fld("Course / activity", <input value={form.course || ""} onChange={(e) => set("course", e.target.value)} />)}
              {fld("Provider", <input value={form.provider || ""} onChange={(e) => set("provider", e.target.value)} />)}
              {fld("Estimated cost", <input value={form.cost || ""} onChange={(e) => set("cost", e.target.value)} placeholder="$" />)}
              {fld("Preferred date", <input type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} />)}
              {fld("Justification", <textarea rows={2} value={form.justification || ""} onChange={(e) => set("justification", e.target.value)} />)}
            </div>
          )}
          {active.key === "equipment" && (
            <div className="sf-grid">
              {fld("Item", <input value={form.item || ""} onChange={(e) => set("item", e.target.value)} />)}
              {fld("Quantity", <input value={form.quantity || ""} onChange={(e) => set("quantity", e.target.value)} placeholder="1" />)}
              {fld("Needed by", <input type="date" value={form.neededBy || ""} onChange={(e) => set("neededBy", e.target.value)} />)}
              {fld("Reason", <textarea rows={2} value={form.reason || ""} onChange={(e) => set("reason", e.target.value)} />)}
            </div>
          )}

          {(active.key === "injury_incident" || active.key === "near_miss") && (
            <div className="sf-grid">
              {fld("What happened", <textarea rows={3} value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="Describe the event, sequence and immediate actions taken" />)}
              {fld("People involved", <input value={form.people || ""} onChange={(e) => set("people", e.target.value)} />)}
              {fld("Immediate cause / contributing factors", <textarea rows={2} value={form.cause || ""} onChange={(e) => set("cause", e.target.value)} />)}
              {fld("Immediate controls put in place", <textarea rows={2} value={form.controls || ""} onChange={(e) => set("controls", e.target.value)} />)}
              <label className="sf-field sf-full sf-check"><input type="checkbox" checked={!!form.notifiable_flag} onChange={(e) => set("notifiable_flag", e.target.checked)} /><span>This may meet the threshold for a notifiable incident (flag for admin - not a legal determination)</span></label>
            </div>
          )}

          {active.key === "daily_risk_assessment" && (
            <div className="sf-grid">
              {fld("Conditions on arrival", <textarea rows={2} value={form.conditions || ""} onChange={(e) => set("conditions", e.target.value)} placeholder="Weather, terrain, access, wildlife" />)}
              {fld("Key hazards identified", <textarea rows={3} value={form.hazards || ""} onChange={(e) => set("hazards", e.target.value)} />)}
              {fld("Controls in place", <textarea rows={3} value={form.controls || ""} onChange={(e) => set("controls", e.target.value)} />)}
              {fld("Stop-work triggers", <textarea rows={2} value={form.stopwork || ""} onChange={(e) => set("stopwork", e.target.value)} />)}
              {fld("Crew on site", <input value={form.crew || ""} onChange={(e) => set("crew", e.target.value)} />)}
            </div>
          )}
          {active.key === "office_risk_assessment" && (
            <div className="sf-grid">
              {fld("Area assessed", <input value={form.area || ""} onChange={(e) => set("area", e.target.value)} />)}
              {fld("Hazards identified", <textarea rows={3} value={form.hazards || ""} onChange={(e) => set("hazards", e.target.value)} />)}
              {fld("Controls in place", <textarea rows={3} value={form.controls || ""} onChange={(e) => set("controls", e.target.value)} />)}
            </div>
          )}
          {active.key === "hazard_report" && (
            <div className="sf-grid">
              {fld("Hazard", <textarea rows={2} value={form.hazard || ""} onChange={(e) => set("hazard", e.target.value)} />)}
              {fld("Risk if not addressed", <textarea rows={2} value={form.risk || ""} onChange={(e) => set("risk", e.target.value)} />)}
              {fld("Suggested control", <textarea rows={2} value={form.control || ""} onChange={(e) => set("control", e.target.value)} />)}
            </div>
          )}
          {active.key === "journey_plan" && (
            <div className="sf-grid">
              {fld("Crew manifest (names)", <textarea rows={2} value={form.crew || ""} onChange={(e) => set("crew", e.target.value)} />)}
              {fld("Next of kin contacts", <textarea rows={2} value={form.nok || ""} onChange={(e) => set("nok", e.target.value)} />)}
              {fld("Route / legs", <textarea rows={2} value={form.route || ""} onChange={(e) => set("route", e.target.value)} />)}
              {fld("Vehicle & pre-departure check", <textarea rows={2} value={form.vehicle || ""} onChange={(e) => set("vehicle", e.target.value)} />)}
              {fld("Check-in schedule & overdue action", <textarea rows={2} value={form.checkin || ""} onChange={(e) => set("checkin", e.target.value)} />)}
            </div>
          )}
          {active.key === "pre_mobilisation" && (
            <div className="sf-grid">
              {fld("Statutory approvals & licensing", <textarea rows={2} value={form.approvals || ""} onChange={(e) => set("approvals", e.target.value)} />)}
              {fld("Scope of works", <textarea rows={2} value={form.scope || ""} onChange={(e) => set("scope", e.target.value)} />)}
              {fld("Site access readiness", <textarea rows={2} value={form.access || ""} onChange={(e) => set("access", e.target.value)} />)}
              {fld("Equipment register", <textarea rows={2} value={form.equipment || ""} onChange={(e) => set("equipment", e.target.value)} />)}
              {fld("Crew competency", <textarea rows={2} value={form.competency || ""} onChange={(e) => set("competency", e.target.value)} />)}
            </div>
          )}
          {active.key === "site_erp" && (
            <div className="sf-grid">
              {fld("Site access & GPS", <textarea rows={2} value={form.access || ""} onChange={(e) => set("access", e.target.value)} placeholder="Access description and coordinates" />)}
              {fld("Call-in-this-order contacts", <textarea rows={2} value={form.contacts || ""} onChange={(e) => set("contacts", e.target.value)} />)}
              {fld("Muster point & evacuation", <textarea rows={2} value={form.muster || ""} onChange={(e) => set("muster", e.target.value)} />)}
              {fld("Nearest medical / hospital", <textarea rows={2} value={form.medical || ""} onChange={(e) => set("medical", e.target.value)} />)}
              {fld("Scenario notes (snake bite, heat, serious injury, bushfire, missing person, breakdown)", <textarea rows={3} value={form.scenarios || ""} onChange={(e) => set("scenarios", e.target.value)} />)}
            </div>
          )}

          <div className="sf-actions">
            <button className="sf-submit" onClick={submit}><Send size={14} /> Submit</button>
            <button className="sf-cancel" onClick={backToHub}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sf">
      <header className="sf-hero">
        <span>Ecology Consulting - Staff services</span>
        <h1>WHS &amp; EC Forms</h1>
        <p>Field forms, WHS reports and staff requests - all in one place. Submissions are saved to your history; requests and incidents route to admin for review.</p>
      </header>

      {error ? <p className="sf-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="sf-success"><CheckCircle2 size={15} /> {message}</p> : null}

      <button className="sf-history-btn" onClick={() => setView("history")}><History size={15} /> View my submission history</button>

      {GROUPS.map((g) => (
        <section key={g.label} className="sf-group">
          <div className="sf-group-label">{g.label}</div>
          <div className="sf-picker">
            {g.forms.map((f) => (
              <button key={f.key} className="sf-pick" onClick={() => openForm(f)}>
                <div className="sf-pick-icon" style={{ background: f.kind === "whs" ? "#f3ece0" : "#eef3e4", color: f.kind === "whs" ? "#8a5b2e" : "#2c6a34" }}><f.Icon size={20} /></div>
                <div className="sf-pick-title">{f.label}</div>
                <div className="sf-pick-blurb">{f.blurb}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
