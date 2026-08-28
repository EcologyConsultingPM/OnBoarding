import { useEffect, useState, useCallback } from "react";
import {
  ClipboardList, Plus, Send, CheckCircle2, AlertCircle, RotateCcw,
  Clock, X, User, CalendarCheck, CircleCheckBig, CircleX,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS = {
  awaiting_acceptance: { label: "Awaiting acceptance", bg: "#fbf1dd", fg: "#a5772b" },
  accepted:            { label: "Accepted", bg: "#e3edf5", fg: "#2a6591" },
  in_progress:         { label: "In progress", bg: "#e7f0e5", fg: "#2c6a34" },
  submitted:           { label: "Submitted for review", bg: "#efe7f0", fg: "#7d3b5c" },
  revising:            { label: "Revision requested", bg: "#fbecea", fg: "#a5342a" },
  complete:            { label: "Complete", bg: "#e5f1dd", fg: "#2c6a34" },
  declined:            { label: "Declined", bg: "#fbecea", fg: "#a5342a" },
  withdrawn:           { label: "Withdrawn", bg: "#eeeeea", fg: "#687268" },
};

const STAFF_WORKABLE = ["accepted", "in_progress", "revising"];
const STAFF_VISIBLE_ACTIVE = ["awaiting_acceptance", ...STAFF_WORKABLE, "submitted"];
// These are the accepted workflow states that must appear in the in-portal calendar.
const CALENDAR_ACTIVE_STATES = ["accepted", "in_progress", "submitted", "revising"];

// Task Briefs: staff must accept an assigned brief before it becomes active.
// The StaffHome calendar reads accepted/active task due dates from the same API.
export default function RemoteTasks({ isAdmin, staffStates = null, compact = false, showHome = true }) {
  const { session } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ assigned_to: "", project: "", task: "", due_date: "", budget_hours: "", deliverable: "", resources: "", notes: "" });
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({});

  const authFetch = useCallback((method, url, body) => fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("GET", "/api/remote-tasks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTasks(data.tasks || []);
      setStaff(data.staff || []);
    } catch (err) {
      setError(err.message || "Could not load task briefs.");
    }
  }, [authFetch]);

  useEffect(() => {
    if (session?.access_token) load();
  }, [session, load]);

  const resetForm = () => setForm({ assigned_to: "", project: "", task: "", due_date: "", budget_hours: "", deliverable: "", resources: "", notes: "" });

  const assign = async () => {
    setError("");
    if (!form.assigned_to) return setError("Choose a staff member.");
    if (!form.project.trim() || !form.task.trim()) return setError("Project and task are required.");
    try {
      const res = await authFetch("POST", "/api/remote-tasks", form);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCreating(false);
      resetForm();
      await load();
    } catch (err) {
      setError(err.message || "Could not assign task.");
    }
  };

  const act = async (id, body) => {
    setError("");
    try {
      const res = await authFetch("PATCH", "/api/remote-tasks", { id, ...body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpenId(null);
      setDraft({});
      await load();
    } catch (err) {
      setError(err.message || "Could not update task.");
    }
  };

  const withdraw = async (id) => {
    if (!window.confirm("Withdraw this task? It will remain in the audit history.")) return;
    try {
      const res = await authFetch("DELETE", `/api/remote-tasks?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (err) {
      setError(err.message || "Could not withdraw task.");
    }
  };

  const field = (label, node) => <label className="rt-f"><span>{label}</span>{node}</label>;
  const terminal = (status) => ["complete", "declined", "withdrawn"].includes(status);
  // Notifications is the decision gate. Other staff workspaces may request
  // only accepted/active states so a pending task never appears twice.
  const visibleTasks = !isAdmin && Array.isArray(staffStates)
    ? tasks.filter((task) => staffStates.includes(task.status))
    : tasks;

  return (
    <section className={`rt${compact ? " rt--compact" : ""}`} aria-label="Task briefs">
      <div className="rt-head">
        <h2><ClipboardList size={17} /> Task briefs</h2>
        {!isAdmin && showHome ? <a className="workspace-home-link rt-home-link" href="/">Home</a> : null}
        {isAdmin && (
          <button className="rt-new" onClick={() => setCreating((current) => !current)}>
            <Plus size={14} /> Assign a task
          </button>
        )}
      </div>
      <p className="rt-sub">
        {isAdmin
          ? "Assign work to staff. A task becomes active only when the staff member accepts it."
          : "Respond to new task briefs, then track progress and submit work for review."}
      </p>

      {error ? <p className="rt-error"><AlertCircle size={15} /> {error}</p> : null}

      {isAdmin && creating && (
        <div className="rt-create">
          <div className="rt-grid">
            {field("Assign to", <select value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })}><option value="">Select staff…</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>)}
            {field("Project", <input value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value })} placeholder="Project name or number" />)}
            {field("Task", <input value={form.task} onChange={(event) => setForm({ ...form, task: event.target.value })} placeholder="One-line description" />)}
            {field("Due date", <input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />)}
            {field("Budget hours", <input type="number" min="0" step="0.5" value={form.budget_hours} onChange={(event) => setForm({ ...form, budget_hours: event.target.value })} placeholder="e.g. 3.0" />)}
            {field("Deliverable", <input value={form.deliverable} onChange={(event) => setForm({ ...form, deliverable: event.target.value })} placeholder="What the finished product is" />)}
            {field("Resources", <input value={form.resources} onChange={(event) => setForm({ ...form, resources: event.target.value })} placeholder="Links to files or folders" />)}
            {field("Notes / questions", <textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Instructions, assumptions or issues" />)}
          </div>
          <p className="rt-accept-note"><Clock size={13} /> The task remains awaiting acceptance and does not appear in the staff calendar until it is accepted.</p>
          <div className="rt-create-actions">
            <button className="rt-assign" onClick={assign}><Send size={14} /> Send task brief</button>
            <button className="rt-cancel" onClick={() => { setCreating(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="rt-list">
        {visibleTasks.length ? visibleTasks.map((task) => {
          const status = STATUS[task.status] || STATUS.awaiting_acceptance;
          const isOpen = openId === task.id;
          const overdue = task.due_date && STAFF_VISIBLE_ACTIVE.includes(task.status) && task.status !== "complete" && new Date(task.due_date) < new Date(new Date().toDateString());
          const inCalendar = task.due_date && CALENDAR_ACTIVE_STATES.includes(task.status);

          return (
            <article key={task.id} className="rt-card">
              <div className="rt-card-top">
                <div className="rt-card-main">
                  <div className="rt-card-project">{task.project}</div>
                  <div className="rt-card-task">{task.task}</div>
                  <div className="rt-card-meta">
                    {isAdmin ? <><User size={11} /> {task.assignee} · </> : null}
                    {task.due_date ? <span className={overdue ? "rt-overdue" : ""}>Due {new Date(task.due_date).toLocaleDateString("en-AU")}{overdue ? " · overdue" : ""}</span> : "No due date"}
                    {task.budget_hours ? ` · ${task.budget_hours}h` : ""}
                  </div>
                </div>
                <span className="rt-status" style={{ background: status.bg, color: status.fg }}>{status.label}</span>
              </div>

              {task.deliverable ? <div className="rt-line"><strong>Deliverable:</strong> {task.deliverable}</div> : null}
              {task.resources ? <div className="rt-line"><strong>Resources:</strong> {task.resources}</div> : null}
              {task.notes ? <div className="rt-line"><strong>Notes:</strong> {task.notes}</div> : null}
              {task.decline_reason ? <div className="rt-line rt-decline-note"><strong>Decline / reassignment request:</strong> {task.decline_reason}</div> : null}
              {task.staff_note ? <div className="rt-line rt-staff-note"><strong>Staff update:</strong> {task.staff_note}</div> : null}
              {task.review_note ? <div className="rt-line rt-review-note"><strong>Review:</strong> {task.review_note}</div> : null}
              {!isAdmin && inCalendar ? <div className="rt-calendar-note"><CalendarCheck size={13} /> Added to your staff portal calendar on the due date.</div> : null}
              {!isAdmin && task.status === "awaiting_acceptance" ? <div className="rt-calendar-note pending"><Clock size={13} /> Accept this task to add its due date to your staff portal calendar.</div> : null}

              {!isAdmin && !terminal(task.status) && (
                isOpen ? (
                  <div className="rt-actions-open">
                    <textarea rows={2} placeholder={task.status === "awaiting_acceptance" ? "Question, availability issue or reassignment request…" : "Progress update or a question…"} value={draft.staff_note ?? task.staff_note ?? ""} onChange={(event) => setDraft({ ...draft, staff_note: event.target.value })} />
                    <div className="rt-actions-row">
                      {task.status === "awaiting_acceptance" && <button className="rt-btn accept" onClick={() => act(task.id, { action: "accept", staff_note: draft.staff_note })}><CircleCheckBig size={12} /> Accept task</button>}
                      {task.status === "awaiting_acceptance" && <button className="rt-btn decline" onClick={() => act(task.id, { action: "decline", decline_reason: draft.staff_note ?? "" })}><CircleX size={12} /> Decline / reassign</button>}
                      {task.status !== "awaiting_acceptance" && <button className="rt-btn note" onClick={() => act(task.id, { staff_note: draft.staff_note ?? "" })}>Save update</button>}
                      {task.status === "awaiting_acceptance" && <button className="rt-btn note" onClick={() => act(task.id, { staff_note: draft.staff_note ?? "" })}>Ask question</button>}
                      {task.status === "accepted" && <button className="rt-btn start" onClick={() => act(task.id, { action: "start", staff_note: draft.staff_note })}>Start work</button>}
                      {STAFF_WORKABLE.includes(task.status) && <button className="rt-btn submit" onClick={() => act(task.id, { action: "submit", staff_note: draft.staff_note })}><Send size={12} /> Submit for review</button>}
                      <button className="rt-btn cancel" onClick={() => { setOpenId(null); setDraft({}); }}>Close</button>
                    </div>
                  </div>
                ) : <button className="rt-open-btn" onClick={() => { setOpenId(task.id); setDraft({}); }}>{task.status === "awaiting_acceptance" ? "Respond to task" : "Update / submit"}</button>
              )}

              {isAdmin && task.status !== "complete" && task.status !== "withdrawn" && (
                isOpen ? (
                  <div className="rt-actions-open">
                    <textarea rows={2} placeholder="Review note or revision instructions…" value={draft.review_note ?? task.review_note ?? ""} onChange={(event) => setDraft({ ...draft, review_note: event.target.value })} />
                    <div className="rt-actions-row">
                      {task.status === "submitted" && <button className="rt-btn complete" onClick={() => act(task.id, { action: "complete", review_note: draft.review_note })}><CheckCircle2 size={12} /> Mark complete</button>}
                      {task.status === "submitted" && <button className="rt-btn revise" onClick={() => act(task.id, { action: "revise", review_note: draft.review_note })}><RotateCcw size={12} /> Request revision</button>}
                      <button className="rt-btn note" onClick={() => act(task.id, { review_note: draft.review_note ?? "" })}>Save note</button>
                      <button className="rt-btn withdraw" onClick={() => withdraw(task.id)}>Withdraw</button>
                      <button className="rt-btn cancel" onClick={() => { setOpenId(null); setDraft({}); }}>Close</button>
                    </div>
                  </div>
                ) : <button className="rt-open-btn" onClick={() => { setOpenId(task.id); setDraft({}); }}>{task.status === "declined" ? "Review reassignment request" : "Review"}</button>
              )}
            </article>
          );
        }) : <p className="rt-empty">{isAdmin ? "No tasks assigned yet. Use ‘Assign a task’ to create one." : Array.isArray(staffStates) && staffStates.includes("awaiting_acceptance") ? "No task briefs are awaiting your decision." : Array.isArray(staffStates) ? "No accepted task briefs are active in My Projects." : "No task briefs assigned to you right now."}</p>}
      </div>
    </section>
  );
}
