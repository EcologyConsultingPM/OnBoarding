"use client";

import { useEffect, useState, useCallback } from "react";
import { ClipboardList, Plus, Send, CheckCircle2, AlertCircle, RotateCcw, Clock, X, User } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS = {
  assigned:    { label: "Assigned",     bg: "#fbf1dd", fg: "#a5772b" },
  in_progress: { label: "In progress",  bg: "#e3edf5", fg: "#2a6591" },
  submitted:   { label: "Submitted",    bg: "#efe7f0", fg: "#7d3b5c" },
  revising:    { label: "Revision requested", bg: "#fbecea", fg: "#a5342a" },
  complete:    { label: "Complete",     bg: "#e5f1dd", fg: "#2c6a34" },
};

// Task Briefs — a sub-component of Remote Operations. Admin/SE assigns tasks to
// staff; staff see only their own assignments and work them through the flow.
export default function RemoteTasks({ isAdmin }) {
  const { session } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ assigned_to: "", project: "", task: "", due_date: "", budget_hours: "", deliverable: "", resources: "", notes: "" });
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({});

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("GET", "/api/remote-tasks");
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      setTasks(d.tasks || []); setStaff(d.staff || []);
    } catch (e) { setError(e.message); }
  }, [authFetch]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  const assign = async () => {
    setError("");
    if (!form.assigned_to) { setError("Choose a staff member."); return; }
    if (!form.project.trim() || !form.task.trim()) { setError("Project and task are required."); return; }
    try {
      const res = await authFetch("POST", "/api/remote-tasks", form);
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      setCreating(false);
      setForm({ assigned_to: "", project: "", task: "", due_date: "", budget_hours: "", deliverable: "", resources: "", notes: "" });
      await load();
    } catch (e) { setError(e.message); }
  };

  const act = async (id, body) => {
    try { const res = await authFetch("PATCH", "/api/remote-tasks", { id, ...body }); const d = await res.json(); if (!res.ok) throw new Error(d.error); setOpenId(null); setDraft({}); await load(); }
    catch (e) { setError(e.message); }
  };

  const withdraw = async (id) => {
    if (!window.confirm("Withdraw this task?")) return;
    try { const res = await authFetch("DELETE", `/api/remote-tasks?id=${id}`); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(); } catch (e) { setError(e.message); }
  };

  const fld = (label, node) => <label className="rt-f"><span>{label}</span>{node}</label>;

  return (
    <div className="rt">
      <div className="rt-head">
        <h2><ClipboardList size={17} /> Task briefs</h2>
        {isAdmin && <button className="rt-new" onClick={() => setCreating((c) => !c)}><Plus size={14} /> Assign a task</button>}
      </div>
      <p className="rt-sub">{isAdmin ? "Assign work to staff. They'll see it in their portal with a notification." : "Tasks assigned to you. Work through them and submit for review."}</p>

      {error ? <p className="rt-error"><AlertCircle size={15} /> {error}</p> : null}

      {isAdmin && creating && (
        <div className="rt-create">
          <div className="rt-grid">
            {fld("Assign to", <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}><option value="">Select staff…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>)}
            {fld("Project", <input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} placeholder="Project name or number" />)}
            {fld("Task", <input value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} placeholder="One-line description" />)}
            {fld("Due date", <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />)}
            {fld("Budget hours", <input type="number" step="0.5" value={form.budget_hours} onChange={(e) => setForm({ ...form, budget_hours: e.target.value })} placeholder="e.g. 3.0" />)}
            {fld("Deliverable", <input value={form.deliverable} onChange={(e) => setForm({ ...form, deliverable: e.target.value })} placeholder="What the finished product is" />)}
            {fld("Resources", <input value={form.resources} onChange={(e) => setForm({ ...form, resources: e.target.value })} placeholder="Links to files/folders" />)}
            {fld("Notes / questions", <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Instructions, assumptions or issues" />)}
          </div>
          <div className="rt-create-actions">
            <button className="rt-assign" onClick={assign}><Send size={14} /> Assign task</button>
            <button className="rt-cancel" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="rt-list">
        {tasks.length ? tasks.map((t) => {
          const st = STATUS[t.status] || STATUS.assigned;
          const isOpen = openId === t.id;
          const overdue = t.due_date && t.status !== "complete" && new Date(t.due_date) < new Date(new Date().toDateString());
          return (
            <div key={t.id} className="rt-card">
              <div className="rt-card-top">
                <div className="rt-card-main">
                  <div className="rt-card-project">{t.project}</div>
                  <div className="rt-card-task">{t.task}</div>
                  <div className="rt-card-meta">
                    {isAdmin ? <><User size={11} /> {t.assignee} · </> : null}
                    {t.due_date ? <span className={overdue ? "rt-overdue" : ""}>Due {new Date(t.due_date).toLocaleDateString("en-AU")}{overdue ? " · overdue" : ""}</span> : "No due date"}
                    {t.budget_hours ? ` · ${t.budget_hours}h` : ""}
                  </div>
                </div>
                <span className="rt-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              </div>

              {t.deliverable ? <div className="rt-line"><strong>Deliverable:</strong> {t.deliverable}</div> : null}
              {t.resources ? <div className="rt-line"><strong>Resources:</strong> {t.resources}</div> : null}
              {t.notes ? <div className="rt-line"><strong>Notes:</strong> {t.notes}</div> : null}
              {t.staff_note ? <div className="rt-line rt-staff-note"><strong>Staff update:</strong> {t.staff_note}</div> : null}
              {t.review_note ? <div className="rt-line rt-review-note"><strong>Review:</strong> {t.review_note}</div> : null}

              {/* Staff actions */}
              {!isAdmin && t.status !== "complete" && (
                isOpen ? (
                  <div className="rt-actions-open">
                    <textarea rows={2} placeholder="Progress update or a question…" value={draft.staff_note ?? t.staff_note ?? ""} onChange={(e) => setDraft({ ...draft, staff_note: e.target.value })} />
                    <div className="rt-actions-row">
                      {t.status === "assigned" && <button className="rt-btn start" onClick={() => act(t.id, { action: "start", staff_note: draft.staff_note })}>Start</button>}
                      <button className="rt-btn note" onClick={() => act(t.id, { staff_note: draft.staff_note ?? "" })}>Save update</button>
                      {["assigned", "in_progress", "revising"].includes(t.status) && <button className="rt-btn submit" onClick={() => act(t.id, { action: "submit", staff_note: draft.staff_note })}><Send size={12} /> Submit for review</button>}
                      <button className="rt-btn cancel" onClick={() => { setOpenId(null); setDraft({}); }}>Close</button>
                    </div>
                  </div>
                ) : <button className="rt-open-btn" onClick={() => { setOpenId(t.id); setDraft({}); }}>Update / submit</button>
              )}

              {/* Admin/SE review actions */}
              {isAdmin && (
                isOpen ? (
                  <div className="rt-actions-open">
                    <textarea rows={2} placeholder="Review note / revision instructions…" value={draft.review_note ?? t.review_note ?? ""} onChange={(e) => setDraft({ ...draft, review_note: e.target.value })} />
                    <div className="rt-actions-row">
                      {t.status === "submitted" && <button className="rt-btn complete" onClick={() => act(t.id, { action: "complete", review_note: draft.review_note })}><CheckCircle2 size={12} /> Mark complete</button>}
                      {t.status === "submitted" && <button className="rt-btn revise" onClick={() => act(t.id, { action: "revise", review_note: draft.review_note })}><RotateCcw size={12} /> Request revision</button>}
                      <button className="rt-btn note" onClick={() => act(t.id, { review_note: draft.review_note ?? "" })}>Save note</button>
                      <button className="rt-btn withdraw" onClick={() => withdraw(t.id)}>Withdraw</button>
                      <button className="rt-btn cancel" onClick={() => { setOpenId(null); setDraft({}); }}>Close</button>
                    </div>
                  </div>
                ) : t.status !== "complete" ? <button className="rt-open-btn" onClick={() => { setOpenId(t.id); setDraft({}); }}>Review</button> : null
              )}
            </div>
          );
        }) : <p className="rt-empty">{isAdmin ? "No tasks assigned yet. Use \u201cAssign a task\u201d to create one." : "No tasks assigned to you right now."}</p>}
      </div>
    </div>
  );
}
