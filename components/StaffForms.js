"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarDays, GraduationCap, Package, Send, CheckCircle2, AlertCircle, Clock, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const TYPES = [
  { key: "leave", label: "Leave Request", Icon: CalendarDays, blurb: "Annual, personal, or other leave." },
  { key: "training", label: "Training Request", Icon: GraduationCap, blurb: "Courses, conferences, accreditation." },
  { key: "equipment", label: "Equipment Request", Icon: Package, blurb: "Field gear, PPE, IT or other equipment." },
];

const STATUS_STYLE = {
  submitted: { bg: "#fbf1dd", fg: "#a5772b", label: "Submitted" },
  approved: { bg: "#e5f1dd", fg: "#2c6a34", label: "Approved" },
  declined: { bg: "#fbecea", fg: "#a5342a", label: "Declined" },
  cancelled: { bg: "#eef0e9", fg: "#6b755f", label: "Cancelled" },
};

export default function StaffForms() {
  const { session } = useAuth();
  const [active, setActive] = useState(null); // which form is open
  const [form, setForm] = useState({});
  const [mine, setMine] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const auth = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/service-requests");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMine(data.requests);
    } catch (e) { setError(e.message); }
  }, [auth]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  const notify = (m) => { setMessage(m); setError(""); setTimeout(() => setMessage(""), 2600); };

  const openForm = (key) => { setActive(key); setForm({}); setError(""); };

  const submit = async () => {
    setError("");
    // Build a title + details per type.
    let title = "", details = {};
    if (active === "leave") {
      if (!form.leaveType || !form.startDate || !form.endDate) { setError("Leave type, start and end dates are required."); return; }
      title = `${form.leaveType} leave · ${form.startDate} → ${form.endDate}`;
      details = { leaveType: form.leaveType, startDate: form.startDate, endDate: form.endDate, reason: form.reason || "" };
    } else if (active === "training") {
      if (!form.course || !form.provider) { setError("Course name and provider are required."); return; }
      title = `Training: ${form.course}`;
      details = { course: form.course, provider: form.provider, cost: form.cost || "", date: form.date || "", justification: form.justification || "" };
    } else if (active === "equipment") {
      if (!form.item) { setError("Item is required."); return; }
      title = `Equipment: ${form.item}`;
      details = { item: form.item, quantity: form.quantity || "1", reason: form.reason || "", neededBy: form.neededBy || "" };
    }
    try {
      const res = await auth("POST", "/api/service-requests", { request_type: active, title, details });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActive(null); setForm({}); await load(); notify("Request submitted for approval.");
    } catch (e) { setError(e.message); }
  };

  const cancel = async (id) => {
    if (!window.confirm("Cancel this request?")) return;
    try { const res = await auth("PATCH", `/api/service-requests/${id}`, { action: "cancel" }); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(); } catch (e) { setError(e.message); }
  };

  const field = (label, node) => (
    <label className="sf-field"><span>{label}</span>{node}</label>
  );

  return (
    <div className="sf">
      <header className="sf-hero">
        <span>Ecology Consulting · Staff services</span>
        <h1>WHS &amp; EC Forms</h1>
        <p>Submit a request and it goes to the admin team for approval. You can track the status of everything you've submitted below.</p>
      </header>

      {error ? <p className="sf-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="sf-success"><CheckCircle2 size={15} /> {message}</p> : null}

      {/* Form picker */}
      {!active ? (
        <div className="sf-picker">
          {TYPES.map(({ key, label, Icon, blurb }) => (
            <button key={key} className="sf-pick" onClick={() => openForm(key)}>
              <div className="sf-pick-icon"><Icon size={20} /></div>
              <div className="sf-pick-title">{label}</div>
              <div className="sf-pick-blurb">{blurb}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="sf-form">
          <div className="sf-form-head">
            <h2>{TYPES.find((t) => t.key === active)?.label}</h2>
            <button className="sf-close" onClick={() => setActive(null)}><X size={16} /></button>
          </div>

          {active === "leave" && (
            <div className="sf-grid">
              {field("Leave type", (
                <select value={form.leaveType || ""} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
                  <option value="">Select…</option>
                  {["Annual", "Personal / carer's", "Compassionate", "Long service", "Unpaid", "Other"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ))}
              {field("Start date", <input type="date" value={form.startDate || ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />)}
              {field("End date", <input type="date" value={form.endDate || ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />)}
              {field("Reason (optional)", <textarea rows={2} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />)}
            </div>
          )}

          {active === "training" && (
            <div className="sf-grid">
              {field("Course / activity", <input value={form.course || ""} onChange={(e) => setForm({ ...form, course: e.target.value })} />)}
              {field("Provider", <input value={form.provider || ""} onChange={(e) => setForm({ ...form, provider: e.target.value })} />)}
              {field("Estimated cost", <input value={form.cost || ""} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="$" />)}
              {field("Preferred date", <input type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} />)}
              {field("Justification", <textarea rows={2} value={form.justification || ""} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="How this supports your role / development" />)}
            </div>
          )}

          {active === "equipment" && (
            <div className="sf-grid">
              {field("Item", <input value={form.item || ""} onChange={(e) => setForm({ ...form, item: e.target.value })} />)}
              {field("Quantity", <input value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="1" />)}
              {field("Needed by", <input type="date" value={form.neededBy || ""} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />)}
              {field("Reason", <textarea rows={2} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />)}
            </div>
          )}

          <div className="sf-actions">
            <button className="sf-submit" onClick={submit}><Send size={14} /> Submit for approval</button>
            <button className="sf-cancel" onClick={() => setActive(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* My requests */}
      <section className="sf-mine">
        <h2><Clock size={16} /> My requests</h2>
        {mine.length ? (
          <div className="sf-list">
            {mine.map((r) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.submitted;
              return (
                <div key={r.id} className="sf-row">
                  <div className="sf-row-main">
                    <div className="sf-row-title">{r.title}</div>
                    <div className="sf-row-meta">{r.request_type} · {new Date(r.created_at).toLocaleDateString("en-AU")}{r.admin_note ? ` · Note: ${r.admin_note}` : ""}</div>
                  </div>
                  <span className="sf-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  {r.status === "submitted" ? <button className="sf-row-cancel" onClick={() => cancel(r.id)}>Cancel</button> : null}
                </div>
              );
            })}
          </div>
        ) : <p className="sf-empty">You haven't submitted any requests yet.</p>}
      </section>
    </div>
  );
}
