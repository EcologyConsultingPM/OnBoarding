"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS = {
  not_commenced: { label: "Not commenced", tone: "not-commenced" },
  active: { label: "Active", tone: "active" },
  need_info: { label: "Information required", tone: "need-info" },
  paused_other: { label: "Paused", tone: "paused" },
  qa_review: { label: "In QA review", tone: "qa-review" },
  completed: { label: "Completed", tone: "completed" },
};

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
// Persists whatever's currently being typed into the add-entry form — not
// the pending sheet rows themselves (those are already saved server-side the
// moment "Add to today's sheet" is clicked). This covers the gap where a
// backgrounded tab gets discarded by the OS and reloaded from scratch,
// which would otherwise silently lose whatever was half-typed.
const DRAFT_KEY = "ecology-consulting:daily-timesheet-form-draft";
function readFormDraft() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || Date.now() - Number(saved.savedAt || 0) > 1000 * 60 * 60 * 24) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return saved.form && typeof saved.form === "object" ? saved.form : null;
  } catch {
    return null;
  }
}
function writeFormDraft(form) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), form }));
  } catch {}
}
function clearFormDraft() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
}

function blankForm(project) {
  const source = project?.sources?.[0];
  const allocation = source?.allocations?.[0];
  return {
    id: null, // set when editing an existing pending row
    projectId: project?.id || "",
    activityId: "",
    sourceId: source?.id || "",
    allocationId: allocation?.id || "",
    workDate: localToday(),
    category: project?.template?.category_options?.[0] || "",
    information: "",
    hours: "",
    status: "not_commenced",
    notableIssues: "",
    customData: {},
  };
}

export default function StaffDailyTimesheet({ embedded = false }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState([]);
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [assignedActivities, setAssignedActivities] = useState([]);
  const [form, setForm] = useState(() => readFormDraft() || blankForm(null));
  const [restoredDraft] = useState(() => Boolean(readFormDraft()));
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [processResult, setProcessResult] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session?.access_token]);

  const staffName = session?.user?.user_metadata?.full_name || session?.user?.email || "Signed-in staff member";

  const selected = useMemo(() => projects.find((project) => project.id === form.projectId) || null, [projects, form.projectId]);
  const selectedSource = useMemo(() => selected?.sources?.find((source) => source.id === form.sourceId) || null, [selected, form.sourceId]);
  const projectActivities = useMemo(() => assignedActivities.filter((activity) => activity.projectId === form.projectId), [assignedActivities, form.projectId]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const [draftsRes, activitiesRes] = await Promise.all([
        fetch("/api/staff-timesheet-drafts", { headers: headers(), cache: "no-store" }),
        fetch("/api/my-activities", { headers: headers(), cache: "no-store" }),
      ]);
      const draftsBody = await draftsRes.json();
      const activitiesBody = await activitiesRes.json();
      if (!draftsRes.ok) throw new Error(draftsBody.error || "Could not load your daily timesheet.");
      const nextProjects = draftsBody.eligibleProjects || [];
      setProjects(nextProjects);
      setPending(draftsBody.pending || []);
      setHistory(draftsBody.history || []);
      setAssignedActivities((activitiesBody.activities || []).filter((activity) => ["accepted", "actioned"].includes(activity.acceptanceStatus)));
      setReady(Boolean(draftsBody.ready));
      setForm((current) => {
        if (current.projectId && nextProjects.some((project) => project.id === current.projectId)) return current;
        return blankForm(nextProjects[0]);
      });
    } catch (loadError) {
      setError(loadError.message || "Could not load your daily timesheet.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);
  useEffect(() => { load(); }, [load]);

  // Autosave the in-progress "new entry" form so a backgrounded tab getting
  // discarded and reloaded by the OS doesn't silently lose it. Deliberately
  // skipped while editing an existing pending row (form.id set) — that data
  // already lives server-side, and re-surfacing a stale edit-draft after a
  // reload would be more confusing than just re-opening it fresh.
  useEffect(() => {
    if (form.id) return;
    const hasContent = form.information.trim() || form.hours || form.notableIssues.trim();
    if (!hasContent) { clearFormDraft(); return; }
    writeFormDraft(form);
  }, [form]);

  const setProject = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    setForm((current) => ({ ...blankForm(project), id: current.id, workDate: current.workDate }));
  };
  const setSource = (sourceId) => {
    const source = selected?.sources?.find((item) => item.id === sourceId);
    setForm((current) => ({ ...current, sourceId, allocationId: source?.allocations?.[0]?.id || "" }));
  };
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const resetForm = () => setForm(blankForm(selected || projects[0]));

  const editPending = (row) => {
    setForm({
      id: row.id,
      projectId: row.projectId,
      activityId: row.activityId || "",
      sourceId: row.sourceId,
      allocationId: row.allocationId,
      workDate: row.workDate,
      category: row.category || "",
      information: row.information || "",
      hours: row.hours ?? "",
      status: row.status || "not_commenced",
      notableIssues: row.notableIssues || "",
      customData: row.customData || {},
    });
    setError("");
    setMessage("");
  };

  const removePending = async (id) => {
    if (!window.confirm("Remove this entry from today's sheet?")) return;
    try {
      const response = await fetch(`/api/staff-timesheet-drafts?id=${id}`, { method: "DELETE", headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not remove the entry.");
      setPending((current) => current.filter((row) => row.id !== id));
      if (form.id === id) resetForm();
    } catch (removeError) {
      setError(removeError.message || "Could not remove the entry.");
    }
  };

  const saveEntry = async () => {
    if (!form.projectId || !form.sourceId || !form.allocationId) {
      setError("Choose a project, budget source and allocation.");
      return;
    }
    if (!form.workDate) {
      setError("Choose a work date.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        projectId: form.projectId,
        sourceId: form.sourceId,
        allocationId: form.allocationId,
        activityId: form.activityId || undefined,
        workDate: form.workDate,
        activityCategory: form.category,
        activityInformation: form.information,
        hours: form.hours,
        status: form.status,
        notableIssues: form.notableIssues,
        customData: form.customData,
      };
      const response = form.id
        ? await fetch("/api/staff-timesheet-drafts", { method: "PATCH", headers: headers(), body: JSON.stringify({ id: form.id, ...payload }) })
        : await fetch("/api/staff-timesheet-drafts", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save the entry.");
      if (form.id) {
        setPending((current) => current.map((row) => (row.id === form.id ? body.draft : row)));
        setMessage("Entry updated on today's sheet.");
      } else {
        setPending((current) => [...current, body.draft]);
        setMessage("Added to today's sheet.");
      }
      resetForm();
      clearFormDraft();
      setProcessResult(null);
      setTimeout(() => setMessage(""), 3000);
    } catch (saveError) {
      setError(saveError.message || "Could not save the entry.");
    } finally {
      setSaving(false);
    }
  };

  const process = async () => {
    if (!pending.length) return;
    if (!window.confirm(`Process ${pending.length} entr${pending.length === 1 ? "y" : "ies"} into the Project Tracker? This can't be undone.`)) return;
    setProcessing(true);
    setError("");
    try {
      const response = await fetch("/api/staff-timesheet-drafts/process", { method: "POST", headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not process today's sheet.");
      setProcessResult(body);
      await load();
    } catch (processError) {
      setError(processError.message || "Could not process today's sheet.");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return (
    <main className={`staff-tracker${embedded ? " st-embedded" : ""}`}>
      <div className="st-loading"><Loader2 size={18} className="spin" /> Loading your daily timesheet…</div>
    </main>
  );

  return (
    <main className={`staff-tracker${embedded ? " st-embedded" : ""}`}>
      <header className="st-hero">
        {!embedded ? <a className="workspace-home-link" href="/">Home</a> : null}
        <span><ClipboardList size={14} /> Ecology Consulting · staff daily timesheet</span>
        <h1>Daily Timesheet</h1>
        <p>Add entries across any of your allocated projects as you go through the day. Nothing reaches a project's Project Tracker until you press Process — until then, everything here stays editable.</p>
      </header>

      {!ready ? (
        <div className="st-notice"><AlertCircle size={17} /><span>Project Tracker entries will become available once an administrator has enabled your project, configured its template and locked it for staff use.</span></div>
      ) : null}
      {restoredDraft ? <div className="st-success"><CheckCircle2 size={16} /> Restored your in-progress entry from this device.</div> : null}
      {error ? <div className="st-error"><AlertCircle size={16} /> {error}</div> : null}
      {message ? <div className="st-success"><CheckCircle2 size={16} /> {message}</div> : null}

      {processResult ? (
        <div className={processResult.complete ? "st-success" : "st-notice"}>
          {processResult.complete ? <CheckCircle2 size={16} /> : <AlertCircle size={17} />}
          <span>
            {processResult.complete
              ? `Process completed — ${processResult.processed} entr${processResult.processed === 1 ? "y" : "ies"} sent to the Project Tracker. A fresh sheet is ready.`
              : `${processResult.processed} processed, ${processResult.failed} need${processResult.failed === 1 ? "s" : ""} attention below before they can go through.`}
          </span>
        </div>
      ) : null}

      {!projects.length ? (
        <div className="st-empty">
          <ClipboardList size={22} />
          <strong>No Project Tracker is available yet</strong>
          <span>When an administrator allocates you to an active project and locks its tracker template, it will appear here.</span>
        </div>
      ) : (
        <section className="st-entry-card">
          <div className="st-card-head">
            <div>
              <span className="st-kicker">{form.id ? "Editing sheet entry" : "New sheet entry"}</span>
              <h2>{form.id ? "Update entry" : "Add to today's sheet"}</h2>
              <p>Fields marked as core are locked by the administrator template.</p>
            </div>
            {form.id ? <button type="button" className="st-secondary" onClick={resetForm}><X size={13} /> Cancel edit</button> : null}
          </div>
          <div className="st-form-grid">
            <label>Work date<input type="date" value={form.workDate} onChange={(event) => setField("workDate", event.target.value)} /></label>
            <label>Staff member<span className="st-readonly"><UserRound size={13} /> {staffName}</span></label>
            <label>
              Project
              <select value={form.projectId} onChange={(event) => setProject(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label className="st-wide">
              Assigned project activity
              <select value={form.activityId || ""} onChange={(event) => {
                const activity = projectActivities.find((item) => item.id === event.target.value);
                setForm((current) => ({
                  ...current,
                  activityId: event.target.value,
                  category: activity?.taskCategory || current.category,
                  information: activity ? (current.information || activity.title) : current.information,
                  status: activity?.status || current.status,
                }));
              }}>
                <option value="">General project work (not linked to an activity)</option>
                {projectActivities.map((activity) => <option key={activity.id} value={activity.id}>{activity.title}{activity.dueDate ? ` · Due ${formatDate(activity.dueDate)}` : ""}</option>)}
              </select>
            </label>
            <label>
              Budget source
              <select value={form.sourceId} onChange={(event) => setSource(event.target.value)}>
                {selected?.sources?.map((source) => <option key={source.id} value={source.id}>{source.source_name} · {source.source_code}</option>)}
              </select>
            </label>
            <label>
              Allocation
              <select value={form.allocationId} onChange={(event) => setField("allocationId", event.target.value)}>
                {selectedSource?.allocations?.map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.allocation_name} · {allocation.allocation_code}</option>)}
              </select>
            </label>
            <label>
              Activity category
              <select value={form.category} onChange={(event) => setField("category", event.target.value)}>
                {selected?.template?.category_options?.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>
              Hours
              <input inputMode="decimal" type="number" min="0.1" max="24" step="0.1" value={form.hours} onChange={(event) => setField("hours", event.target.value)} placeholder="0.0" />
            </label>
            <label>
              Status
              <select value={form.status} className={`st-status-select ${STATUS[form.status]?.tone || ""}`} onChange={(event) => setField("status", event.target.value)}>
                {Object.entries(STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
              </select>
            </label>
            <label className="st-wide">
              Activity information
              <textarea rows={3} value={form.information} onChange={(event) => setField("information", event.target.value)} placeholder="Describe the work completed or planned." />
            </label>
            <label className="st-wide">
              Notable issues
              <textarea rows={2} value={form.notableIssues} onChange={(event) => setField("notableIssues", event.target.value)} placeholder="Leave blank if there are no notable issues." />
            </label>
          </div>
          <div className="st-entry-actions">
            <span className={`st-status-preview ${STATUS[form.status]?.tone || ""}`}>
              {form.status === "completed" ? <CheckCircle2 size={15} /> : form.status === "active" ? <PlayCircle size={15} /> : form.status === "paused_other" ? <PauseCircle size={15} /> : <Clock3 size={15} />} {STATUS[form.status]?.label}
            </span>
            <button type="button" onClick={saveEntry} disabled={saving}>
              {saving ? <><Loader2 size={15} className="spin" /> Saving…</> : <><Plus size={15} /> {form.id ? "Update sheet entry" : "Add to today's sheet"}</>}
            </button>
          </div>
        </section>
      )}

      <section className="st-history">
        <div className="st-card-head">
          <div>
            <span className="st-kicker">Today's sheet</span>
            <h2>Pending entries ({pending.length})</h2>
            <p>Nothing here reaches a project until you press Process — stays exactly as-is if you come back tomorrow or next week.</p>
          </div>
          <button type="button" onClick={process} disabled={processing || !pending.length}>
            {processing ? <><Loader2 size={15} className="spin" /> Processing…</> : <><Play size={15} /> Process {pending.length || ""}</>}
          </button>
        </div>
        {pending.length ? (
          <div className="st-table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Project / allocation</th><th>Category</th><th>Hours</th><th>Status</th><th>Issue</th><th></th></tr></thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id} className={row.errorMessage ? "st-row-error" : ""}>
                    <td>{formatDate(row.workDate)}</td>
                    <td><strong>{row.projectName}</strong><small>{row.allocationLabel}</small></td>
                    <td>{row.category || "—"}</td>
                    <td>{row.hours ?? "—"}</td>
                    <td><span className={`st-status ${STATUS[row.status]?.tone || ""}`}>{STATUS[row.status]?.label || row.status}</span></td>
                    <td>{row.errorMessage ? <span className="st-error-inline"><AlertCircle size={12} /> {row.errorMessage}</span> : "—"}</td>
                    <td className="st-row-actions">
                      <button type="button" onClick={() => editPending(row)} title="Edit">Edit</button>
                      <button type="button" className="ec-icon-btn--destructive" onClick={() => removePending(row.id)} title="Remove"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="st-empty small"><ClipboardList size={18} /><span>Nothing on today's sheet yet — add an entry above.</span></div>
        )}
      </section>

      <section className="st-history">
        <div className="st-card-head">
          <div>
            <span className="st-kicker">Your audit history</span>
            <h2>Previous submissions</h2>
            <p>Every processed entry, permanent from the moment it's submitted.</p>
          </div>
          <button type="button" className="st-secondary" onClick={() => setShowHistory((value) => !value)}>{showHistory ? "Hide" : "Show"} ({history.length})</button>
        </div>
        {showHistory ? (
          history.length ? (
            <div className="st-table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Project / allocation</th><th>Category</th><th>Hours</th><th>Status</th><th>Processed</th></tr></thead>
                <tbody>
                  {history.slice(0, 100).map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.workDate)}</td>
                      <td><strong>{row.projectName}</strong><small>{row.allocationLabel}</small></td>
                      <td>{row.category || "—"}</td>
                      <td>{row.hours ?? "—"}</td>
                      <td><span className={`st-status ${STATUS[row.status]?.tone || ""}`}>{STATUS[row.status]?.label || row.status}</span></td>
                      <td>{formatDate(row.processedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="st-empty small"><ClipboardList size={18} /><span>Nothing processed yet.</span></div>
        ) : null}
      </section>
    </main>
  );
}
