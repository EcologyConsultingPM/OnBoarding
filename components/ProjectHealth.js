"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Calendar, Flag, Users, AlertCircle, ExternalLink, ClipboardList, ChevronDown, ChevronUp, Lock } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

// The controlled activity-status set, colour-coded. Shared shape so the staff
// selector and any admin rollup read identically.
export const ACTIVITY_STATUS = {
  not_commenced: { label: "Not yet commenced", color: "#5c6b52" },
  active: { label: "Active", color: "#3d7a35" },
  need_info: { label: "Need for information", color: "#b08948" },
  paused_other: { label: "Paused / other", color: "#c0392b" },
  qa_review: { label: "In QA review", color: "#4197D0" },
  completed: { label: "Completed", color: "#2a8091" },
};
const STATUS_ORDER = ["not_commenced", "active", "need_info", "paused_other", "qa_review", "completed"];

function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

export default function ProjectHealth({ projectId, onBack, showBack = true }) {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activities, setActivities] = useState([]);
  const [pauseDraft, setPauseDraft] = useState({}); // { [activityId]: reasonText }
  const [scheduleOpen, setScheduleOpen] = useState(false);

  useEffect(() => {
    if (!session?.access_token || !projectId) return;
    (async () => {
      try {
        const [projectRes, activitiesRes] = await Promise.all([
          fetch(`/api/projects/${projectId}?audience=staff`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
          fetch(`/api/projects/${projectId}/activities?audience=staff`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        ]);
        const payload = await projectRes.json();
        if (!projectRes.ok) throw new Error(payload.error || "Could not load this project.");
        setData(payload);
        const actPayload = await activitiesRes.json();
        if (activitiesRes.ok) setActivities(actPayload.activities || []);
      } catch (requestError) {
        setError(requestError.message || "Could not load this project.");
      }
    })();
  }, [session, projectId]);

  const myUserId = session?.user?.id;

  const updateStatus = async (activity, status, progressPercent = activity.progress_percent ?? 0) => {
    const reason = status === "paused_other" ? (pauseDraft[activity.id] || "").trim() : "";
    if (status === "paused_other" && !reason) {
      setPauseDraft((d) => ({ ...d, [activity.id]: d[activity.id] || "" }));
      return; // wait for a reason
    }
    try {
      const response = await fetch(`/api/my-activities?id=${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status, pauseReason: reason, progressPercent }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update status.");
      setActivities((list) => list.map((a) => (a.id === activity.id ? payload.activity : a)));
    } catch (requestError) {
      setError(requestError.message || "Could not update status.");
    }
  };

  if (error) return <div className="proj-error" role="alert"><AlertCircle size={16} /> {error}</div>;
  if (!data) return <p style={{ color: "#6b755f", fontWeight: 600 }}>Loading project…</p>;

  const { project, schedule, allocations } = data;
  const budgetDollars = money(project.budget_dollars);
  const myActivities = activities.filter((activity) => activity.staff_user_id === myUserId);
  const myCompletion = myActivities.length
    ? Math.round((myActivities.reduce((sum, activity) => sum + Number(activity.progress_percent || 0), 0) / myActivities.length) * 100) / 100
    : 0;

  return (
    <div className="proj-detail">
      {showBack ? <button className="proj-back" onClick={onBack}><ArrowLeft size={15} /> All projects</button> : null}

      <div className="proj-detail-head">
        <h1>{project.name}</h1>
        {project.client_name ? <p>{project.client_name}{project.client_contact ? ` · ${project.client_contact}` : ""}</p> : null}
        {project.description ? <p className="proj-desc">{project.description}</p> : null}
        {project.sharepoint_link ? (
          <a className="proj-sharepoint" href={project.sharepoint_link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {project.sharepoint_label || "Project workspace"}</a>
        ) : null}
      </div>

      {/* Budget summary — staff have visual view access per spec. Stage 3 will
          fill in "used" from timesheets; for now it shows the planned budget. */}
      <div className="proj-budget-cards">
        <div className="proj-budget-card">
          <span>Budget hours</span>
          <strong>{project.budget_hours ?? "—"}</strong>
        </div>
        <div className="proj-budget-card">
          <span>Budget value</span>
          <strong>{budgetDollars ?? "—"}</strong>
        </div>
        <div className="proj-budget-card">
          <span>Dates</span>
          <strong className="proj-budget-dates">{project.start_date || "—"} → {project.end_date || "—"}</strong>
        </div>
        <div className="proj-budget-card">
          <span>My activity completion</span>
          <strong>{myCompletion}%</strong>
        </div>
      </div>
      <p className="proj-budget-note">Live budget burn-down from timesheets appears here once timesheets are enabled.</p>

      <a className="proj-timesheet-link" href="https://staff.ecologyconsulting.au/Timesheet" target="_blank" rel="noreferrer">
        <ExternalLink size={14} /> Enter your daily timesheet
      </a>

      {(() => {
        const mine = myActivities;
        if (!mine.length) return null;
        return (
          <section className="proj-section">
            <h2><ClipboardList size={17} /> My work activities</h2>
            <div className="proj-activities">
              {mine.map((activity) => {
                const current = ACTIVITY_STATUS[activity.status] || ACTIVITY_STATUS.not_commenced;
                return (
                  <div key={activity.id} className="proj-activity">
                    <div className="proj-activity-head">
                      <div>
                        <div className="proj-activity-title">{activity.title}</div>
                        {activity.task_category ? <div className="proj-activity-cat">{activity.task_category}</div> : null}
                      </div>
                      <span className="proj-activity-badge" style={{ background: `${current.color}1a`, color: current.color }}>{current.label}</span>
                    </div>
                    <div className="proj-activity-statuses">
                      <label>
                        Status
                        <select
                          value={activity.status || "not_commenced"}
                          disabled={activity.locked === true}
                          style={{ borderColor: `${current.color}88`, color: current.color }}
                          onChange={(event) => updateStatus(activity, event.target.value, activity.progress_percent ?? 0)}
                        >
                          {STATUS_ORDER.map((key) => <option key={key} value={key}>{ACTIVITY_STATUS[key].label}</option>)}
                        </select>
                      </label>
                      <label>
                        Activity complete
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="5"
                          disabled={activity.locked === true}
                          defaultValue={activity.progress_percent ?? 0}
                          onBlur={(event) => updateStatus(activity, activity.status || "not_commenced", event.target.value)}
                        />
                      </label>
                      {activity.locked ? <span className="proj-activity-locked">Locked for project-lead review</span> : null}
                    </div>
                    {activity.status === "paused_other" || pauseDraft[activity.id] !== undefined ? (
                      <div className="proj-activity-reason">
                        <input
                          value={pauseDraft[activity.id] ?? activity.pause_reason ?? ""}
                          onChange={(e) => setPauseDraft((d) => ({ ...d, [activity.id]: e.target.value }))}
                          placeholder="Reason for pause / other (required)"
                        />
                        <button onClick={() => updateStatus(activity, "paused_other")}>Save reason</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      <section className="proj-section proj-schedule-panel">
        <button type="button" className="proj-schedule-toggle" onClick={() => setScheduleOpen((current) => !current)} aria-expanded={scheduleOpen}>
          <span><Calendar size={17} /> Project schedule</span>
          <small>{schedule.length} key date{schedule.length === 1 ? "" : "s"} · {schedule.filter((item) => item.status === "completed").length} completed</small>
          {scheduleOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
        {scheduleOpen ? (schedule.length ? (
          <ol className="proj-schedule">
            {schedule.map((item) => {
              const status = ACTIVITY_STATUS[item.status] || ACTIVITY_STATUS.not_commenced;
              const assignedStaff = Array.isArray(item.assigned_staff) ? item.assigned_staff : [];
              return <li key={item.id} className={item.milestone ? "proj-schedule-item milestone" : "proj-schedule-item"}>
                <div className="proj-schedule-marker">{item.milestone ? <Flag size={13} /> : item.sort_order}</div>
                <div className="proj-schedule-body">
                  <div className="proj-schedule-line-head">
                    <div className="proj-schedule-title">{item.title}</div>
                    <span className="proj-schedule-status" style={{ background: `${status.color}1a`, color: status.color }}>{status.label}</span>
                  </div>
                  {item.detail ? <div className="proj-schedule-detail" style={{ color: "#3a4740" }}>{item.detail}</div> : null}
                  {(item.start_date || item.end_date) ? <div className="proj-schedule-dates" style={{ color: "#5c6b52" }}>Key dates: {item.start_date || "—"} → {item.end_date || "—"}</div> : null}
                  <div className="proj-schedule-assignees" style={{ color: "#3a4740" }}><Users size={13} /><strong>Assigned staff:</strong> {assignedStaff.length ? assignedStaff.map((staff) => <span key={staff.activityId || staff.id}>{staff.email} · {staff.progressPercent}%</span>) : <span>Not assigned</span>}</div>
                  {item.locked ? <small className="proj-schedule-lock"><Lock size={12} /> Schedule line locked by the project lead</small> : null}
                  {assignedStaff.some((staff) => staff.id === myUserId) ? <small className="proj-schedule-update-hint">Update your assigned delivery status above in My work activities.</small> : null}
                </div>
              </li>;
            })}
          </ol>
        ) : <p className="proj-muted">No schedule items have been added yet.</p>) : null}
      </section>

      <section className="proj-section">
        <h2><Users size={17} /> Project team</h2>
        {allocations.length ? (
          <div className="proj-team">
            {allocations.map((a) => (
              <div key={a.id} className="proj-team-row">
                <div className="proj-team-name">{a.email || "Team member"}</div>
                <div className="proj-team-role">{a.role_on_project || "—"}</div>
                <div className="proj-team-hours">{a.allocated_hours != null ? `${a.allocated_hours} hrs` : "—"}</div>
              </div>
            ))}
          </div>
        ) : <p className="proj-muted">No team members allocated yet.</p>}
      </section>
    </div>
  );
}
