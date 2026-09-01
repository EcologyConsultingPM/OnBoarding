"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  UserRound,
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
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
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
    category: project?.template?.categories?.[0] || "",
    information: "",
    hours: "",
    status: "not_commenced",
    notableIssues: "",
    customData: {},
  };
}

export default function StaffProjectTracker({ embedded = false, initialProjectId = "" }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState([]);
  const [entries, setEntries] = useState([]);
  const [assignedActivities, setAssignedActivities] = useState([]);
  const [form, setForm] = useState(blankForm(null));
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    }),
    [session?.access_token],
  );
  const selected = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [projects, form.projectId],
  );
  const selectedSource = useMemo(
    () =>
      selected?.sources?.find((source) => source.id === form.sourceId) || null,
    [selected, form.sourceId],
  );
  const selectedAllocation = useMemo(
    () =>
      selectedSource?.allocations?.find(
        (allocation) => allocation.id === form.allocationId,
      ) || null,
    [selectedSource, form.allocationId],
  );
  const staffName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.email ||
    "Signed-in staff member";

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const [response, activitiesResponse] = await Promise.all([
        fetch("/api/project-tracker-entries", { headers: headers(), cache: "no-store" }),
        fetch("/api/my-activities", { headers: headers(), cache: "no-store" }),
      ]);
      const body = await response.json();
      const activityBody = await activitiesResponse.json();
      if (!response.ok) throw new Error(body.error || "Could not load your Project Tracker.");
      const nextProjects = body.eligibleProjects || [];
      setProjects(nextProjects);
      setEntries(body.entries || []);
      setAssignedActivities((activityBody.activities || []).filter((activity) => ["accepted", "actioned"].includes(activity.acceptanceStatus)));
      setReady(Boolean(body.ready));
      setForm((current) => {
        const preferredProject = nextProjects.find((project) => project.id === initialProjectId);
        if (current.projectId && nextProjects.some((project) => project.id === current.projectId)) return current;
        return blankForm(preferredProject || nextProjects[0]);
      });
    } catch (loadError) {
      setError(loadError.message || "Could not load your Project Tracker.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);
  useEffect(() => {
    load();
  }, [load]);

  const setProject = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    setForm(blankForm(project));
  };
  const projectActivities = useMemo(
    () => assignedActivities.filter((activity) => activity.projectId === form.projectId),
    [assignedActivities, form.projectId],
  );
  const setSource = (sourceId) => {
    const source = selected?.sources?.find((item) => item.id === sourceId);
    setForm((current) => ({
      ...current,
      sourceId,
      allocationId: source?.allocations?.[0]?.id || "",
    }));
  };
  const setField = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    if (!selected || !selectedSource || !selectedAllocation) {
      setError("Choose a project, budget source and allocation.");
      return;
    }
    if (
      !form.workDate ||
      !form.category ||
      !form.information.trim() ||
      !form.hours ||
      !form.status
    ) {
      setError(
        "Complete work date, category, activity information, hours and status.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/project-tracker-entries", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
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
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error || "Could not save the Project Tracker entry.",
        );
      setEntries((current) => [body.entry, ...current]);
      setForm(blankForm(selected));
      setMessage(
        "Project Tracker entry saved. It is now visible in your Timesheets history.",
      );
      setTimeout(() => setMessage(""), 4000);
    } catch (saveError) {
      setError(
        saveError.message || "Could not save the Project Tracker entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <main className={`staff-tracker${embedded ? " st-embedded" : ""}`}>
        <div className="st-loading">
          <Loader2 size={18} className="spin" /> Loading your Project Tracker…
        </div>
      </main>
    );
  return (
    <main className={`staff-tracker${embedded ? " st-embedded" : ""}`}>
      <header className="st-hero">
        {!embedded ? (
          <a className="workspace-home-link" href="/">
            Home
          </a>
        ) : null}
        <span>
          <ClipboardList size={14} /> Ecology Consulting · staff project
          tracking
        </span>
        <h1>Project Tracker</h1>
        <p>
          Record your allocated project work against the locked project tracker.
          Your submitted entry remains visible in Timesheets as a reference for
          official time entry.
        </p>
      </header>
      {!ready ? (
        <div className="st-notice">
          <AlertCircle size={17} />
          <span>
            Project Tracker entries will become available once an administrator
            has enabled your project, configured its template and locked it for
            staff use.
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="st-error">
          <AlertCircle size={16} /> {error}
        </div>
      ) : null}
      {message ? (
        <div className="st-success">
          <CheckCircle2 size={16} /> {message}
        </div>
      ) : null}
      {!projects.length ? (
        <div className="st-empty">
          <ClipboardList size={22} />
          <strong>No Project Tracker is available yet</strong>
          <span>
            When an administrator allocates you to an active project and locks
            its tracker template, it will appear here.
          </span>
        </div>
      ) : (
        <section className="st-entry-card">
          <div className="st-card-head">
            <div>
              <span className="st-kicker">New entry</span>
              <h2>Record project activity</h2>
              <p>
                Fields marked as core are locked by the administrator template.
              </p>
            </div>
            <span className="st-template-lock">
              <CheckCircle2 size={14} /> Locked template
            </span>
          </div>
          <div className="st-form-grid">
            <label>
              Work date
              <input
                type="date"
                value={form.workDate}
                onChange={(event) => setField("workDate", event.target.value)}
              />
            </label>
            <label>
              Staff member
              <span className="st-readonly">
                <UserRound size={13} /> {staffName}
              </span>
            </label>
            <label>
              Project
              <select
                value={form.projectId}
                onChange={(event) => setProject(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
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
              <small className="st-activity-hint">Select an accepted activity to update its delivery status and linked Gantt progress when this tracker entry is saved.</small>
            </label>
            <label>
              Budget source
              <select
                value={form.sourceId}
                onChange={(event) => setSource(event.target.value)}
              >
                {selected?.sources?.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.source_code} · {source.source_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Allocation
              <select
                value={form.allocationId}
                onChange={(event) =>
                  setField("allocationId", event.target.value)
                }
              >
                {selectedSource?.allocations?.map((allocation) => (
                  <option key={allocation.id} value={allocation.id}>
                    {allocation.allocation_code} · {allocation.allocation_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Activity category
              <select
                value={form.category}
                onChange={(event) => setField("category", event.target.value)}
              >
                {selected?.template?.categories?.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hours
              <input
                inputMode="decimal"
                type="number"
                min="0.1"
                max="24"
                step="0.1"
                value={form.hours}
                onChange={(event) => setField("hours", event.target.value)}
                placeholder="0.0"
              />
            </label>
            <label>
              Status
              <select
                value={form.status}
                className={`st-status-select ${STATUS[form.status]?.tone || ""}`}
                onChange={(event) => setField("status", event.target.value)}
              >
                {Object.entries(STATUS).map(([value, status]) => (
                  <option key={value} value={value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="st-wide">
              Activity information
              <textarea
                rows={3}
                value={form.information}
                onChange={(event) =>
                  setField("information", event.target.value)
                }
                placeholder="Describe the work completed or planned, including the relevant output, location, file or client matter."
              />
            </label>
            <label className="st-wide">
              Notable issues
              <textarea
                rows={2}
                value={form.notableIssues}
                onChange={(event) =>
                  setField("notableIssues", event.target.value)
                }
                placeholder="Record constraints, risks, blocked work, decisions needed or leave blank if there are no notable issues."
              />
            </label>
            {(selected?.template?.customColumns || []).map((column) => (
              <CustomField
                key={column.key}
                column={column}
                value={form.customData?.[column.key] || ""}
                setValue={(value) =>
                  setField("customData", {
                    ...form.customData,
                    [column.key]: value,
                  })
                }
              />
            ))}
          </div>
          {(selected?.template?.guidanceRows || []).length ? (
            <div className="st-guidance">
              <strong>Project guidance</strong>
              {selected.template.guidanceRows.map((row, index) => (
                <div key={index}>
                  <b>{row.label}</b>
                  <span>{row.information}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="st-entry-actions">
            <span
              className={`st-status-preview ${STATUS[form.status]?.tone || ""}`}
            >
              {form.status === "completed" ? (
                <CheckCircle2 size={15} />
              ) : form.status === "active" ? (
                <PlayCircle size={15} />
              ) : form.status === "paused_other" ? (
                <PauseCircle size={15} />
              ) : (
                <Clock3 size={15} />
              )}{" "}
              {STATUS[form.status]?.label}
            </span>
            <button type="button" onClick={submit} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 size={15} className="spin" /> Saving…
                </>
              ) : (
                <>
                  <Plus size={15} /> Save Project Tracker entry
                </>
              )}
            </button>
          </div>
        </section>
      )}
      <section className="st-history">
        <div className="st-card-head">
          <div>
            <span className="st-kicker">Your audit history</span>
            <h2>Recent Project Tracker entries</h2>
            <p>
              These entries also appear in Timesheets to support your official
              time entry.
            </p>
          </div>
        </div>
        {entries.length ? (
          <div className="st-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Project / allocation</th>
                  <th>Activity</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th>Notable issues</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 50).map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.workDate || entry.changed_at)}</td>
                    <td>
                      <strong>{entry.projectName || entry.project_name}</strong>
                      <small>
                        {entry.allocation || entry.task_category || ""}
                      </small>
                    </td>
                    <td>
                      <strong>{entry.category || entry.title}</strong>
                      <small>{entry.information || entry.note || ""}</small>
                    </td>
                    <td>{entry.hours ?? "—"}</td>
                    <td>
                      <span
                        className={`st-status ${STATUS[entry.status]?.tone || ""}`}
                      >
                        {entry.status === "completed" ? (
                          <CheckCircle2 size={13} />
                        ) : null}
                        {STATUS[entry.status]?.label || entry.status}
                      </span>
                    </td>
                    <td>{entry.notableIssues || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="st-empty small">
            <ClipboardList size={18} />
            <span>
              Your submitted Project Tracker entries will appear here and in
              Timesheets.
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
function CustomField({ column, value, setValue }) {
  const props = {
    value,
    onChange: (event) => setValue(event.target.value),
    required: column.required === true,
  };
  return (
    <label className="st-custom-field">
      {column.label}
      {column.type === "textarea" ? (
        <textarea rows={2} {...props} />
      ) : column.type === "select" ? (
        <select {...props}>
          <option value="">Choose…</option>
          {(column.options || []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={
            column.type === "number"
              ? "number"
              : column.type === "date"
                ? "date"
                : "text"
          }
          {...props}
        />
      )}
    </label>
  );
}
