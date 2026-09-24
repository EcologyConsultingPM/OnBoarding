"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileClock,
  ListChecks,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import WorkspaceNav from "./WorkspaceNav";

const STATUS = {
  not_commenced: { label: "Not yet commenced", tone: "not-commenced" },
  active: { label: "Active", tone: "active" },
  need_info: { label: "Information required", tone: "need-info" },
  paused_other: { label: "Paused", tone: "paused" },
  qa_review: { label: "In QA review", tone: "qa-review" },
  completed: { label: "Completed", tone: "completed" },
};

const TABS = [
  { id: "overview", label: "Overview", Icon: TrendingUp },
  { id: "budget", label: "Budget allocation", Icon: ClipboardList },
  { id: "entry", label: "Add timesheet entry", Icon: Plus },
  { id: "history", label: "Your timesheets", Icon: FileClock },
  { id: "projectHistory", label: "Project timesheet history", Icon: FileClock },
  { id: "activities", label: "Work activities", Icon: ListChecks },
];

const TRACKER_LOCATION_KEY = "ec-staff-project-tracker-location";

function readTrackerLocation() {
  if (typeof window === "undefined") return { projectId: "", activeTab: "overview" };
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(TRACKER_LOCATION_KEY) || "null");
    const activeTab = TABS.some((tab) => tab.id === saved?.activeTab) ? saved.activeTab : "overview";
    const legacyProjectId = window.localStorage.getItem("ec-staff-tracker-selected-id") || "";
    return { projectId: saved?.projectId || legacyProjectId, activeTab };
  } catch {
    return { projectId: "", activeTab: "overview" };
  }
}

function writeTrackerLocation(projectId, activeTab) {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.sessionStorage.setItem(TRACKER_LOCATION_KEY, JSON.stringify({ projectId, activeTab }));
    window.localStorage.setItem("ec-staff-tracker-selected-id", projectId);
  } catch {}
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function normaliseActivity(row) {
  return {
    id: row?.id || "",
    projectId: row?.projectId || row?.project_id || "",
    title: row?.title || "Untitled activity",
    detail: row?.detail || "",
    taskCategory: row?.taskCategory || row?.task_category || "",
    budgetHours: row?.budgetHours ?? row?.budget_hours ?? null,
    dueDate: row?.dueDate || row?.due_date || null,
    status: row?.status || "not_commenced",
    acceptanceStatus: row?.acceptanceStatus || row?.acceptance_status || "",
    progressPercent: Number(row?.progressPercent ?? row?.progress_percent ?? 0),
    pauseReason: row?.pauseReason || row?.pause_reason || "",
    staffName: row?.staffName || row?.staff_name || "Unassigned",
    staffUserId: row?.staffUserId || row?.staff_user_id || "",
    isMine: row?.isMine === true || row?.is_mine === true,
    locked: row?.locked === true,
  };
}

function blankForm(project) {
  const source = project?.sources?.[0];
  const allocation = source?.allocations?.[0];
  return {
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

function allocationRows(project, board) {
  if (board?.allocations?.length) return board.allocations;
  return (project?.sources || []).flatMap((source) =>
    (source.allocations || []).map((allocation) => ({
      id: allocation.id,
      code: allocation.allocation_code,
      name: allocation.allocation_name,
      budgetHours: Number(allocation.allocation_hours || 0),
      hoursConsumed: Number(allocation.hours_consumed || 0),
      hoursRemaining: Number(allocation.allocation_hours || 0) - Number(allocation.hours_consumed || 0),
    })),
  );
}

function completionFor(activities) {
  if (!activities.length) return 0;
  return Math.round((activities.reduce((total, item) => total + Math.max(0, Math.min(100, Number(item.progressPercent || 0))), 0) / activities.length) * 10) / 10;
}

function projectDeliveryStatus(activities) {
  if (!activities.length) return "Not yet commenced";
  if (activities.every((activity) => activity.status === "completed")) return "Completed";
  if (activities.some((activity) => activity.status === "active" || activity.status === "qa_review")) return "Active";
  if (activities.some((activity) => activity.status === "need_info" || activity.status === "paused_other")) return "Needs attention";
  return "Not yet commenced";
}

export default function StaffProjectTracker({ embedded = false, initialProjectId = "" }) {
  const { session } = useAuth();
  const sessionUserId = session?.user?.id || "";
  const accessTokenRef = useRef(session?.access_token || "");
  useEffect(() => {
    accessTokenRef.current = session?.access_token || "";
  }, [session?.access_token]);
  const [projects, setProjects] = useState([]);
  const [entryProjects, setEntryProjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [assignedActivities, setAssignedActivities] = useState([]);
  const [form, setForm] = useState(() => blankForm(null));
  const [board, setBoard] = useState(null);
  const [activeTab, setActiveTab] = useState(() => readTrackerLocation().activeTab);
  const [activityDrafts, setActivityDrafts] = useState({});
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [activitySavingId, setActivitySavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Supabase refreshes the access token when a hidden browser tab becomes
  // visible. Keep the latest token in a ref so authentication stays current,
  // without changing the loading callbacks and blanking the tracker on return.
  const headers = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${accessTokenRef.current}` }),
    [],
  );

  const selected = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [projects, form.projectId],
  );
  const entryProject = useMemo(
    () => entryProjects.find((project) => project.id === form.projectId) || selected,
    [entryProjects, selected, form.projectId],
  );
  const detailProject = selected || entryProject;
  const selectedSource = useMemo(
    () => entryProject?.sources?.find((source) => source.id === form.sourceId) || null,
    [entryProject, form.sourceId],
  );
  const selectedAllocation = useMemo(
    () => selectedSource?.allocations?.find((allocation) => allocation.id === form.allocationId) || null,
    [selectedSource, form.allocationId],
  );
  const staffName = session?.user?.user_metadata?.full_name || session?.user?.email || "Signed-in staff member";

  const loadBoard = useCallback(async (projectId) => {
    if (!accessTokenRef.current || !projectId) {
      setBoard(null);
      return;
    }
    setBoardLoading(true);
    try {
      const response = await fetch(`/api/project-tracker-entries?projectId=${projectId}`, { headers: headers(), cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      setBoard(response.ok ? body.board || null : null);
    } catch {
      setBoard(null);
    } finally {
      setBoardLoading(false);
    }
  }, [headers, sessionUserId]);

  const load = useCallback(async () => {
    if (!accessTokenRef.current || !sessionUserId) return;
    setLoading(true);
    setError("");
    try {
      const [trackerResponse, activitiesResponse] = await Promise.all([
        fetch("/api/project-tracker-entries", { headers: headers(), cache: "no-store" }),
        fetch("/api/my-activities", { headers: headers(), cache: "no-store" }),
      ]);
      const trackerBody = await trackerResponse.json().catch(() => ({}));
      const activitiesBody = await activitiesResponse.json().catch(() => ({}));
      if (!trackerResponse.ok) throw new Error(trackerBody.error || "Could not load your Project Tracker.");
      const nextProjects = trackerBody.eligibleProjects || [];
      const nextEntryProjects = trackerBody.entryProjects || nextProjects;
      setProjects(nextProjects);
      setEntryProjects(nextEntryProjects);
      setEntries(trackerBody.entries || []);
      setAssignedActivities((activitiesBody.activities || [])
        .map(normaliseActivity)
        .filter((activity) => ["accepted", "actioned"].includes(activity.acceptanceStatus)));
      setReady(Boolean(trackerBody.ready));
      setForm((current) => {
        const initial = nextProjects.find((project) => project.id === initialProjectId);
        const stillSelected = nextEntryProjects.find((project) => project.id === current.projectId);
        const savedProjectId = readTrackerLocation().projectId;
        const saved = nextEntryProjects.find((project) => project.id === savedProjectId);
        return blankForm(stillSelected || initial || saved || nextProjects[0] || nextEntryProjects[0]);
      });
    } catch (loadError) {
      setError(loadError.message || "Could not load your Project Tracker.");
    } finally {
      setLoading(false);
    }
  }, [headers, initialProjectId, sessionUserId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadBoard(form.projectId); }, [loadBoard, form.projectId]);
  useEffect(() => {
    if (detailProject?.isAssigned === false && !["entry", "history"].includes(activeTab)) setActiveTab("entry");
  }, [activeTab, detailProject?.isAssigned]);
  useEffect(() => {
    writeTrackerLocation(form.projectId, activeTab);
  }, [form.projectId, activeTab]);

  const setProject = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    setForm(blankForm(project));
    setEditingEntry(null);
    setActiveTab("overview");
    setActivityDrafts({});
    writeTrackerLocation(projectId, "overview");
  };

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const projectActivities = useMemo(
    () => assignedActivities.filter((activity) => activity.projectId === form.projectId),
    [assignedActivities, form.projectId],
  );
  const allProjectActivities = useMemo(
    () => (board?.activities || []).map(normaliseActivity),
    [board?.activities],
  );
  const visibleProjectActivities = allProjectActivities.length
    ? allProjectActivities
    : projectActivities.map((activity) => ({ ...activity, isMine: true }));
  const allProjectCompletion = completionFor(allProjectActivities);
  const mineCompletion = completionFor(projectActivities);
  const rows = useMemo(() => allocationRows(selected, board), [selected, board]);
  const totalBudgetHours = Number(board?.totals?.budgetHours ?? rows.reduce((total, row) => total + Number(row.budgetHours || 0), 0));
  const totalConsumedHours = Number(board?.totals?.hoursConsumed ?? rows.reduce((total, row) => total + Number(row.hoursConsumed || 0), 0));
  const totalRemainingHours = totalBudgetHours - totalConsumedHours;
  const myHistory = entries.filter((entry) => entry.projectId === form.projectId);
  // `board.entries` is separately server-authorised for the selected project:
  // it includes the team’s time records but never editable controls, rates,
  // allocation dollars, costs, or any project the signed-in staff member is not
  // allocated to. Staff can therefore see delivery context without gaining an
  // administrator editing path or broader timesheet access.
  const projectTimesheetHistory = board?.entries || [];
  const projectFinancials = selected?.financials || {};
  const projectDeliverables = (selected?.sources || []).map((source) => source.source_name).filter(Boolean);

  const submit = async () => {
    if (!entryProject || !selectedSource || !selectedAllocation) {
      setError("Choose a project budget source and allocation.");
      return;
    }
    if (!form.workDate || !form.category || !form.information.trim() || !form.hours || !form.status) {
      setError("Complete work date, category, activity information, hours and status.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/project-tracker-entries", {
        method: editingEntry ? "PATCH" : "POST",
        headers: headers(),
        body: JSON.stringify({
          id: editingEntry?.id,
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
          entryContext: entryProject.isAssigned === false ? "other_project" : "assigned_project",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not ${editingEntry ? "correct" : "save"} the Project Tracker entry.`);
      setEditingEntry(null);
      setForm(blankForm(entryProject));
      await Promise.all([loadBoard(form.projectId), load()]);
      setMessage(editingEntry ? "Timesheet correction saved. The original and corrected values are retained in the audit trail." : entryProject.isAssigned === false ? "Ad hoc project time saved. It has been recorded against a controlled allocation and retained in the audit trail." : "Timesheet entry saved. Your hours, work status and the project schedule have been updated.");
      setTimeout(() => setMessage(""), 4500);
    } catch (saveError) {
      setError(saveError.message || `Could not ${editingEntry ? "correct" : "save"} the Project Tracker entry.`);
    } finally {
      setSaving(false);
    }
  };

  const editEntry = (entry) => {
    const project = entryProjects.find((item) => item.id === entry.projectId);
    if (!project) {
      setError("This project is no longer available for time entry. Ask the Project Manager to restore the controlled tracker settings if needed.");
      return;
    }
    setForm({
      ...blankForm(project),
      projectId: entry.projectId,
      sourceId: entry.sourceId || project.sources?.[0]?.id || "",
      allocationId: entry.allocationId || project.sources?.[0]?.allocations?.[0]?.id || "",
      activityId: entry.activityId || "",
      workDate: entry.workDate || localToday(),
      category: entry.category || project.template?.category_options?.[0] || "",
      information: entry.information || "",
      hours: entry.hours ?? "",
      status: entry.status || "not_commenced",
      notableIssues: entry.notableIssues || "",
      customData: entry.customData || {},
    });
    setEditingEntry(entry);
    setActiveTab("entry");
    setError("");
    setMessage("Editing your saved entry. Saving keeps the original and corrected values in the audit trail.");
  };

  const cancelEdit = () => {
    setEditingEntry(null);
    setForm(blankForm(selected || entryProjects[0]));
    setActiveTab("history");
  };

  const draftFor = (activity) => activityDrafts[activity.id] || {
    status: activity.status || "not_commenced",
    progressPercent: String(activity.progressPercent ?? 0),
    note: activity.pauseReason || "",
  };

  const setActivityDraft = (activity, field, value) => {
    setActivityDrafts((current) => ({ ...current, [activity.id]: { ...draftFor(activity), [field]: value } }));
  };

  const saveActivityStatus = async (activity) => {
    const draft = draftFor(activity);
    if (draft.status === "paused_other" && !String(draft.note || "").trim()) {
      setError("Add a short reason before pausing an activity.");
      return;
    }
    setActivitySavingId(activity.id);
    setError("");
    try {
      const response = await fetch(`/api/my-activities?id=${activity.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          status: draft.status,
          progressPercent: draft.status === "completed" ? 100 : draft.progressPercent,
          responseNote: draft.status === "paused_other" ? draft.note : "",
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not update this work activity.");
      const updated = normaliseActivity(body.activity);
      setAssignedActivities((current) => current.map((item) => item.id === updated.id ? updated : item));
      setActivityDrafts((current) => ({ ...current, [activity.id]: { status: updated.status, progressPercent: String(updated.progressPercent), note: updated.pauseReason || "" } }));
      await loadBoard(form.projectId);
      setMessage(`Work activity updated to ${STATUS[updated.status]?.label || updated.status}. The delivery schedule and project progress have been refreshed.`);
      setTimeout(() => setMessage(""), 4500);
    } catch (statusError) {
      setError(statusError.message || "Could not update this work activity.");
    } finally {
      setActivitySavingId("");
    }
  };

  if (loading) {
    return <main className={`staff-tracker ${embedded ? "st-embedded" : ""}`}><div className="st-loading"><Loader2 size={18} className="spin" /> Loading your Project Tracker…</div></main>;
  }

  return (
    <main className={`staff-tracker st-portal-layout ${embedded ? "st-embedded" : ""}`} aria-label="Staff Project Tracker">
      {!embedded ? (
        <header className="st-hero">
          <WorkspaceNav audience="staff" />
          <span><ClipboardList size={14} /> Ecology Consulting · staff project tracker</span>
          <h1>Project Tracker</h1>
          <p>View the delivery position for projects assigned to you, update your work activities, and record timesheet entries.</p>
        </header>
      ) : null}

      {!ready ? <div className="st-notice"><AlertCircle size={17} /><span>Your Project Tracker becomes available once your active project allocation and staff tracker template are confirmed.</span></div> : null}
      {error ? <div className="st-error" role="alert"><AlertCircle size={16} /> {error}</div> : null}
      {message ? <div className="st-success" role="status"><CheckCircle2 size={16} /> {message}</div> : null}

      {!projects.length && !entryProjects.length ? (
        <div className="st-empty"><ClipboardList size={22} /><strong>No Project Tracker is available yet</strong><span>When an active project has a staff-visible tracker and controlled allocation, it will appear here.</span></div>
      ) : (
        <div className="st-project-layout">
          <aside className="st-project-list" aria-label="My active projects">
            <div className="st-list-head"><span>My active projects</span><b>{projects.length}</b></div>
            {projects.map((project) => {
              const isSelected = project.id === selected?.id;
              const activityCount = assignedActivities.filter((activity) => activity.projectId === project.id).length;
              return (
                <button key={project.id} type="button" className={`st-project-select ${isSelected ? "selected" : ""}`} onClick={() => setProject(project.id)}>
                  <span className="st-project-select-kicker">Assigned project</span>
                  <strong>{project.name}</strong>
                  <small>{activityCount} allocated work activit{activityCount === 1 ? "y" : "ies"}</small>
                </button>
              );
            })}
            {!projects.length ? <p className="st-project-list-note">No allocated projects yet. Use <strong>Add timesheet entry</strong> to log genuine ad hoc time against an available controlled project.</p> : null}
          </aside>

          <section className="st-project-detail">
            {detailProject ? (
              <>
                <header className="st-project-heading">
                  <h2>{detailProject.name}</h2>
                </header>

                <nav className="st-detail-tabs" role="tablist" aria-label="Project Tracker sections">
                  {TABS.filter((tab) => detailProject.isAssigned !== false || ["entry", "history"].includes(tab.id)).map(({ id, label, Icon }) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "selected" : ""} onClick={() => setActiveTab(id)}><Icon size={15} /> {label}</button>)}
                </nav>

                {activeTab === "overview" ? (
                  <>
                    <section className="st-overview-metrics st-overview-financials" aria-label="Project delivery overview">
                      <div><span>Project delivery status</span><strong className={`st-delivery-status ${projectDeliveryStatus(allProjectActivities).toLowerCase().replaceAll(" ", "-")}`}>{projectDeliveryStatus(allProjectActivities)}</strong></div>
                      <div className="st-deliverable-summary"><span>Deliverable{projectDeliverables.length === 1 ? "" : "s"}</span><strong>{projectDeliverables.length ? projectDeliverables.join(" · ") : "Not recorded"}</strong></div>
                      <div><span>Accepted budget</span><strong>{formatCurrency(projectFinancials.budget)}</strong></div>
                      <div><span>Actual spend</span><strong>{formatCurrency(projectFinancials.actualSpend)}</strong></div>
                      <div className={Number(projectFinancials.remainingBudget || 0) < 0 ? "st-over" : ""}><span>Budget remaining</span><strong>{formatCurrency(projectFinancials.remainingBudget)}</strong></div>
                      <div><span>Budget hours</span><strong>{Number(projectFinancials.budgetHours || totalBudgetHours).toFixed(1)} h</strong></div>
                      <div><span>Actual hours</span><strong>{totalConsumedHours.toFixed(1)} h</strong></div>
                      <div className={totalRemainingHours < 0 ? "st-over" : ""}><span>Hours remaining</span><strong>{totalRemainingHours.toFixed(1)} h</strong></div>
                      <div><span>Project completion</span><strong>{allProjectCompletion}%</strong></div>
                    </section>
                    <section className="st-section-card st-overview-card">
                      <div className="st-section-head"><div><span className="st-kicker"><TrendingUp size={13} /> Live delivery position</span><h3>Overview</h3></div>{boardLoading ? <Loader2 size={16} className="spin" /> : null}</div>
                      <div className="st-progress-line"><div><span>Project work activity completion</span><b>{allProjectCompletion}% complete</b></div><i><strong style={{ width: `${allProjectCompletion}%` }} /></i></div>
                      <div className="st-progress-line"><div><span>My allocated work activity completion</span><b>{mineCompletion}% complete</b></div><i><strong className="mine" style={{ width: `${mineCompletion}%` }} /></i></div>
                      <ul className="st-overview-list">
                        <li><CheckCircle2 size={15} /> {allProjectActivities.filter((activity) => activity.status === "completed").length} of {allProjectActivities.length} project activities completed</li>
                        <li><PlayCircle size={15} /> {projectActivities.filter((activity) => activity.status === "active").length} of your activities currently active</li>
                        <li><Clock3 size={15} /> {projectActivities.filter((activity) => activity.status === "not_commenced").length} of your activities not yet commenced</li>
                      </ul>
                    </section>
                  </>
                ) : null}

                {activeTab === "budget" ? (
                  <section className="st-section-card st-allocation-card">
                    <div className="st-section-head"><div><span className="st-kicker"><ClipboardList size={13} /> Controlled budget allocation</span><h3>Budget allocations</h3><p>Hour allocations are controlled by the Project Manager. They are shown here for planning only and cannot be edited in the Staff Portal.</p></div></div>
                    <div className="st-budget-summary">
                      <div><span>Allocated hours</span><strong>{totalBudgetHours.toFixed(1)} h</strong></div>
                      <div><span>Hours logged</span><strong>{totalConsumedHours.toFixed(1)} h</strong></div>
                      <div className={totalRemainingHours < 0 ? "st-over" : ""}><span>Hours remaining</span><strong>{totalRemainingHours.toFixed(1)} h</strong></div>
                    </div>
                    <div className="st-table-wrap st-allocation-table">
                      <table>
                        <thead><tr><th>Budget allocation</th><th>Allocated hours</th><th>Hours used</th><th>Hours remaining</th><th>Progress</th></tr></thead>
                        <tbody>{rows.map((row) => {
                          const used = Number(row.hoursConsumed || 0);
                          const planned = Number(row.budgetHours || 0);
                          const remaining = planned - used;
                          const usedPercent = planned ? Math.min(100, Math.round((used / planned) * 100)) : 0;
                          return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.code}</small></td><td>{planned.toFixed(1)} h</td><td>{used.toFixed(1)} h</td><td className={remaining < 0 ? "st-negative" : ""}>{remaining.toFixed(1)} h</td><td><div className="st-budget-bar"><i style={{ width: `${usedPercent}%` }} /></div>{usedPercent}%</td></tr>;
                        })}{!rows.length ? <tr><td colSpan={5} className="st-table-empty">No hour allocations have been configured for this project yet.</td></tr> : null}</tbody>
                      </table>
                    </div>
                  </section>
                ) : null}

                {activeTab === "entry" ? (
                  <section className="st-section-card st-entry-card">
                    <div className="st-section-head"><div><span className="st-kicker">{editingEntry ? <Pencil size={13} /> : <Plus size={13} />} {editingEntry ? "Correct saved timesheet" : "New timesheet entry"}</span><h3>{editingEntry ? "Correct your recorded time" : "Record project activity"}</h3><p>{editingEntry ? "You can correct your own saved entry. The original and corrected values remain in the controlled audit trail." : "Save your actual hours against a controlled allocation. For work on an unassigned project, select Other active project and record general project work only."}</p></div><span className="st-template-lock"><CheckCircle2 size={14} /> Locked template</span></div>
                    {entryProject?.isAssigned === false ? <div className="st-ad-hoc-note"><AlertCircle size={15} /><span><strong>Other active project:</strong> this is an ad hoc time entry. It cannot be linked to another staff member’s activity and is retained in the tracker audit trail for Project Manager review.</span></div> : null}
                    <div className="st-form-grid">
                      <label className="st-wide">Timesheet project<select value={form.projectId} disabled={Boolean(editingEntry)} onChange={(event) => { const project = entryProjects.find((item) => item.id === event.target.value); setForm((current) => ({ ...blankForm(project), workDate: current.workDate })); setEditingEntry(null); }}>{entryProjects.map((project) => <option key={project.id} value={project.id}>{project.isAssigned ? "Assigned project · " : "Other active project · "}{project.name}</option>)}</select><small className="st-activity-hint">Other active projects are available for genuine ad hoc time only; they do not grant project-board or activity access.</small></label>
                      <label>Work date<input type="date" value={form.workDate} onChange={(event) => setField("workDate", event.target.value)} /></label>
                      <label>Staff member<span className="st-readonly"><UserRound size={13} /> {staffName}</span></label>
                      <label className="st-wide">Assigned project activity<select value={form.activityId} disabled={entryProject?.isAssigned === false || Boolean(editingEntry)} onChange={(event) => {
                        const activity = projectActivities.find((item) => item.id === event.target.value);
                        setForm((current) => ({ ...current, activityId: event.target.value, category: activity?.taskCategory || current.category, information: activity?.title || "", status: activity?.status || current.status }));
                      }}><option value="">General project work (not linked to an activity)</option>{entryProject?.isAssigned !== false ? projectActivities.map((activity) => <option key={activity.id} value={activity.id}>{activity.title}{activity.dueDate ? ` · Due ${formatDate(activity.dueDate)}` : ""}</option>) : null}</select><small className="st-activity-hint">Use the Work activities tab to update a task without logging time.</small></label>
                      <label>Budget source<select value={form.sourceId} disabled={Boolean(editingEntry)} onChange={(event) => { const source = entryProject?.sources?.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, sourceId: event.target.value, allocationId: source?.allocations?.[0]?.id || "" })); }}>{entryProject?.sources?.map((source) => <option key={source.id} value={source.id}>{source.source_name} · {source.source_code}</option>)}</select></label>
                      <label>Budget allocation<select value={form.allocationId} disabled={Boolean(editingEntry)} onChange={(event) => setField("allocationId", event.target.value)}>{selectedSource?.allocations?.map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.allocation_name} · {allocation.allocation_code}</option>)}</select></label>
                      <label>Activity category<select value={form.category} onChange={(event) => setField("category", event.target.value)}>{entryProject?.template?.category_options?.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                      <label>Hours<input inputMode="decimal" type="number" min="0.1" max="24" step="0.1" value={form.hours} onChange={(event) => setField("hours", event.target.value)} placeholder="0.0" /></label>
                      <label>Work status<select value={form.status} className={`st-status-select ${STATUS[form.status]?.tone || ""}`} onChange={(event) => setField("status", event.target.value)}>{Object.entries(STATUS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}</select></label>
                      <label className="st-wide">Activity information<textarea rows={3} value={form.information} onChange={(event) => setField("information", event.target.value)} placeholder="Describe the work completed or planned, including the relevant output, location, file or client matter." /></label>
                      <label className="st-wide">Notable issues<textarea rows={2} value={form.notableIssues} onChange={(event) => setField("notableIssues", event.target.value)} placeholder="Record constraints, risks, blocked work or decisions needed; leave blank if there are none." /></label>
                      {(entryProject?.template?.customColumns || []).map((column) => <CustomField key={column.key} column={column} value={form.customData?.[column.key] || ""} setValue={(value) => setField("customData", { ...form.customData, [column.key]: value })} />)}
                    </div>
                    <div className="st-entry-actions"><span className={`st-status-preview ${STATUS[form.status]?.tone || ""}`}>{form.status === "completed" ? <CheckCircle2 size={15} /> : form.status === "active" ? <PlayCircle size={15} /> : form.status === "paused_other" ? <PauseCircle size={15} /> : <Clock3 size={15} />} {STATUS[form.status]?.label}</span><div>{editingEntry ? <button type="button" className="st-cancel-edit" onClick={cancelEdit} disabled={saving}>Cancel</button> : null}<button type="button" onClick={submit} disabled={saving}>{saving ? <><Loader2 size={15} className="spin" /> Saving…</> : editingEntry ? <><Pencil size={15} /> Save correction</> : <><Plus size={15} /> Save timesheet entry</>}</button></div></div>
                  </section>
                ) : null}

                {activeTab === "history" ? (
                  <section className="st-section-card st-history">
                    <div className="st-section-head"><div><span className="st-kicker"><FileClock size={13} /> Your audit history</span><h3>Timesheet history</h3><p>Your saved Project Tracker entries for this project. You can edit your own entry; each correction preserves the original values in the audit trail.</p></div></div>
                    {myHistory.length ? <div className="st-table-wrap"><table><thead><tr><th>Date</th><th>Allocation</th><th>Activity</th><th>Hours</th><th>Status</th><th>Notable issues</th><th>Action</th></tr></thead><tbody>{myHistory.slice(0, 100).map((entry) => <tr key={entry.id}><td>{formatDate(entry.workDate)}</td><td>{entry.allocation || "—"}</td><td><strong>{entry.category || "—"}</strong><small>{entry.information || ""}</small></td><td>{entry.hours ?? "—"} h</td><td><StatusPill status={entry.status} /></td><td>{entry.notableIssues || "—"}</td><td><button type="button" className="st-edit-entry" onClick={() => editEntry(entry)}><Pencil size={12} /> Edit entry</button></td></tr>)}</tbody></table></div> : <div className="st-empty small"><FileClock size={18} /><span>You have not recorded a timesheet entry for this project yet.</span></div>}
                  </section>
                ) : null}

                {activeTab === "projectHistory" ? (
                  <section className="st-section-card st-history st-project-history">
                    <div className="st-section-head"><div><span className="st-kicker"><FileClock size={13} /> Read-only project record</span><h3>Project timesheet history</h3><p>Timesheets entered by everyone assigned to this project. This view is for delivery coordination only: entries cannot be edited here, and commercial rates, costs and profitability remain administrator-only.</p></div>{boardLoading ? <Loader2 size={16} className="spin" /> : null}</div>
                    {projectTimesheetHistory.length ? <div className="st-table-wrap"><table><thead><tr><th>Date</th><th>Staff member</th><th>Allocation</th><th>Activity</th><th>Hours</th><th>Status</th><th>Notable issues</th></tr></thead><tbody>{projectTimesheetHistory.slice(0, 250).map((entry) => <tr key={entry.id}><td>{formatDate(entry.workDate)}</td><td><strong>{entry.staffName || "Team member"}</strong>{entry.isMine ? <small>Your entry</small> : null}</td><td>{entry.allocation || "—"}</td><td><strong>{entry.category || "—"}</strong><small>{entry.activityTitle || entry.information || ""}</small></td><td>{entry.hours ?? "—"} h</td><td><StatusPill status={entry.status} /></td><td>{entry.notableIssues || "—"}</td></tr>)}</tbody></table></div> : <div className="st-empty small"><FileClock size={18} /><span>No team timesheet entries have been recorded for this project yet.</span></div>}
                  </section>
                ) : null}

                {activeTab === "activities" ? (
                  <section className="st-section-card st-work-activities">
                    <div className="st-section-head"><div><span className="st-kicker"><ListChecks size={13} /> Project delivery plan</span><h3>Work activities</h3><p>View all project activities and team assignments. You can update only work allocated to you; saved changes refresh project completion, the administrator’s Gantt chart and the linked schedule.</p></div></div>
                    {visibleProjectActivities.length ? <div className="st-work-list">{visibleProjectActivities.map((activity) => {
                      const draft = draftFor(activity);
                      const status = STATUS[draft.status] || STATUS.not_commenced;
                      return <article key={activity.id} className={`st-work-item ${status.tone}`}><header><div><h4>{activity.title}</h4>{activity.taskCategory ? <small>{activity.taskCategory}</small> : null}</div><StatusPill status={draft.status} /></header>{activity.detail ? <p>{activity.detail}</p> : null}<div className="st-work-meta"><span>Assigned to {activity.staffName || "Unassigned"}</span><span>{activity.budgetHours != null ? `${activity.budgetHours} planned hours` : "Hours not set"}</span><span>{activity.dueDate ? `Due ${formatDate(activity.dueDate)}` : "No due date"}</span></div>{activity.isMine ? <div className="st-work-controls"><label>Status<select value={draft.status} disabled={activity.locked || activitySavingId === activity.id} className={`st-status-select ${status.tone}`} onChange={(event) => setActivityDraft(activity, "status", event.target.value)}>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label><label>Completion<input type="number" min="0" max="100" step="5" value={draft.status === "completed" ? 100 : draft.progressPercent} disabled={activity.locked || draft.status === "completed" || activitySavingId === activity.id} onChange={(event) => setActivityDraft(activity, "progressPercent", event.target.value)} /><small>% complete</small></label>{draft.status === "paused_other" ? <label className="st-work-note">Pause reason<input value={draft.note} disabled={activity.locked || activitySavingId === activity.id} onChange={(event) => setActivityDraft(activity, "note", event.target.value)} placeholder="Reason required" /></label> : null}<button type="button" disabled={activity.locked || activitySavingId === activity.id} onClick={() => saveActivityStatus(activity)}>{activitySavingId === activity.id ? <><Loader2 size={14} className="spin" /> Saving…</> : <><CheckCircle2 size={14} /> Save status</>}</button></div> : <p className="st-team-activity-note">Assigned to another project team member. View-only in the Staff Portal.</p>}{activity.locked && activity.isMine ? <small className="st-locked-note">This activity is locked for project-lead review.</small> : null}</article>;
                    })}</div> : <div className="st-empty small"><ListChecks size={18} /><span>No work activities are visible for this project yet.</span></div>}
                  </section>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}

function StatusPill({ status }) {
  const item = STATUS[status] || STATUS.not_commenced;
  return <span className={`st-status st-work-status ${item.tone}`}>{status === "completed" ? <CheckCircle2 size={13} /> : status === "active" ? <PlayCircle size={13} /> : status === "paused_other" ? <PauseCircle size={13} /> : <Clock3 size={13} />}{item.label}</span>;
}

function CustomField({ column, value, setValue }) {
  const props = { value, onChange: (event) => setValue(event.target.value), required: column.required === true };
  return <label className="st-custom-field">{column.label}{column.type === "textarea" ? <textarea rows={2} {...props} /> : column.type === "select" ? <select {...props}><option value="">Choose…</option>{(column.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={column.type === "number" ? "number" : column.type === "date" ? "date" : "text"} {...props} />}</label>;
}
