"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Calendar, Flag, Users, AlertCircle, ExternalLink } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

export default function ProjectHealth({ projectId, onBack }) {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session?.access_token || !projectId) return;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load this project.");
        setData(payload);
      } catch (requestError) {
        setError(requestError.message || "Could not load this project.");
      }
    })();
  }, [session, projectId]);

  if (error) return <div className="proj-error" role="alert"><AlertCircle size={16} /> {error}</div>;
  if (!data) return <p style={{ color: "#6b755f", fontWeight: 600 }}>Loading project…</p>;

  const { project, schedule, allocations } = data;
  const budgetDollars = money(project.budget_dollars);

  return (
    <div className="proj-detail">
      <button className="proj-back" onClick={onBack}><ArrowLeft size={15} /> All projects</button>

      <div className="proj-detail-head">
        <h1>{project.name}</h1>
        {project.client_name ? <p>{project.client_name}{project.client_contact ? ` · ${project.client_contact}` : ""}</p> : null}
        {project.description ? <p className="proj-desc">{project.description}</p> : null}
        {project.sharepoint_link ? (
          <a className="proj-sharepoint" href={project.sharepoint_link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Project SharePoint</a>
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
      </div>
      <p className="proj-budget-note">Live budget burn-down from timesheets appears here once timesheets are enabled.</p>

      <section className="proj-section">
        <h2><Calendar size={17} /> Project schedule</h2>
        {schedule.length ? (
          <ol className="proj-schedule">
            {schedule.map((item) => (
              <li key={item.id} className={item.milestone ? "proj-schedule-item milestone" : "proj-schedule-item"}>
                <div className="proj-schedule-marker">{item.milestone ? <Flag size={13} /> : item.sort_order}</div>
                <div className="proj-schedule-body">
                  <div className="proj-schedule-title">{item.title}</div>
                  {item.detail ? <div className="proj-schedule-detail">{item.detail}</div> : null}
                  {(item.start_date || item.end_date) ? <div className="proj-schedule-dates">{item.start_date || "—"} → {item.end_date || "—"}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="proj-muted">No schedule items have been added yet.</p>}
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
