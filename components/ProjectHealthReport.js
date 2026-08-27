"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, AlertTriangle, CheckCircle2, AlertCircle, ListFilter, Settings2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

function money(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

export default function ProjectHealthReport({ onManageProject }) {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ client: "", health: "", sort: "risk_first" });

  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const response = await fetch("/api/project-health-report", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load the report.");
        setData(payload);
      } catch (loadError) {
        setError(loadError.message);
      }
    })();
  }, [session]);

  const clients = useMemo(() => [...new Set((data?.rows || []).map((row) => row.client).filter((client) => client && client !== "—"))].sort((a, b) => a.localeCompare(b)), [data]);
  const visibleRows = useMemo(() => {
    const rows = (data?.rows || []).filter((row) => {
      if (filters.client && row.client !== filters.client) return false;
      if (filters.health && row.health !== filters.health) return false;
      return true;
    });
    return [...rows].sort((left, right) => {
      if (filters.sort === "client") return `${left.client} ${left.project}`.localeCompare(`${right.client} ${right.project}`);
      if (filters.sort === "completion_desc") return right.taskCompletion - left.taskCompletion;
      if (filters.sort === "completion_asc") return left.taskCompletion - right.taskCompletion;
      if (filters.sort === "spend_desc") return Number(right.currentSpend || 0) - Number(left.currentSpend || 0);
      if (filters.sort === "budget_asc") return Number(left.remainingBudget ?? Number.MAX_SAFE_INTEGER) - Number(right.remainingBudget ?? Number.MAX_SAFE_INTEGER);
      return Number(right.health === "At Risk") - Number(left.health === "At Risk") || left.project.localeCompare(right.project);
    });
  }, [data, filters]);

  if (error) return <div className="phr"><p className="phr-error"><AlertCircle size={15} /> {error}</p></div>;
  if (!data) return <div className="phr"><p style={{ color: "#a9c0aa", fontWeight: 600 }}>Loading report…</p></div>;

  const { summary } = data;

  return (
    <div className="phr">
      <header className="phr-hero">
        <span><BarChart3 size={17} /> Reporting &amp; analytics · Admin only</span>
        <h1>Project health report</h1>
        <p>Portfolio rollup across active projects. Task completion, current spend and remaining budget are collated from project setup and activity status. Actual timesheet hours come from the external timesheet system.</p>
      </header>

      <div className="phr-summary">
        <div className="phr-sum-card"><div className="phr-sum-value">{summary.active}</div><div className="phr-sum-label">Active projects</div></div>
        <div className="phr-sum-card"><div className="phr-sum-value" style={{ color: "#8fd48a" }}>{summary.onTrack}</div><div className="phr-sum-label">On track</div></div>
        <div className="phr-sum-card"><div className="phr-sum-value" style={{ color: "#ef968d" }}>{summary.atRisk}</div><div className="phr-sum-label">At risk</div></div>
        <div className="phr-sum-card"><div className="phr-sum-value">{summary.avgCompletion}%</div><div className="phr-sum-label">Avg completion</div></div>
      </div>

      <section className="phr-controls" aria-label="Project Tracker Overview controls">
        <div className="phr-controls-title"><ListFilter size={15} /><span>Find and arrange projects</span><b>{visibleRows.length} of {data.rows.length}</b></div>
        <div className="phr-controls-fields">
          <label>Client<select value={filters.client} onChange={(event) => setFilters({ ...filters, client: event.target.value })}><option value="">All clients</option>{clients.map((client) => <option key={client} value={client}>{client}</option>)}</select></label>
          <label>Health<select value={filters.health} onChange={(event) => setFilters({ ...filters, health: event.target.value })}><option value="">All health states</option><option value="On Track">On track</option><option value="At Risk">At risk</option></select></label>
          <label>Sort by<select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}><option value="risk_first">At risk first</option><option value="completion_desc">Completion · high to low</option><option value="completion_asc">Completion · low to high</option><option value="spend_desc">Current spend · high to low</option><option value="budget_asc">Remaining budget · low to high</option><option value="client">Client / project · A–Z</option></select></label>
          <button type="button" className="phr-clear-controls" onClick={() => setFilters({ client: "", health: "", sort: "risk_first" })}>Clear</button>
        </div>
      </section>

      {visibleRows.length ? (
        <div className="phr-table-wrap">
          <table className="phr-table">
            <thead>
              <tr>
                <th>Client</th><th>Project</th><th>Task completion</th><th>Team</th>
                <th>Current spend</th><th>Remaining hrs</th><th>Remaining budget</th><th>Health</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.client}</td>
                  <td className="phr-proj">{row.project}</td>
                  <td>
                    <div className="phr-bar"><div className="phr-bar-fill" style={{ width: `${row.taskCompletion}%`, background: row.health === "At Risk" ? "#dc776f" : "#78bd74" }} /></div>
                    <span className="phr-pct">{row.taskCompletion}%</span>
                  </td>
                  <td>{row.teamSize}</td>
                  <td>{money(row.currentSpend)}</td>
                  <td>{row.remainingHours ?? "—"}</td>
                  <td>{row.remainingBudget != null ? money(row.remainingBudget) : "—"}</td>
                  <td><span className={row.health === "At Risk" ? "phr-health risk" : "phr-health ok"}>{row.health === "At Risk" ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {row.health}</span></td>
                  <td><button type="button" className="phr-manage" onClick={() => onManageProject?.(row.id)}><Settings2 size={13} /> Edit / delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="phr-empty">No projects match the current filters.</p>}

      <p className="phr-note">Health is flagged <strong>At Risk</strong> when budget hours or dollars are exceeded, or an activity is paused / awaiting information. Spend-to-date is derived from completed-activity hours until the external timesheet feed is connected. Use <strong>Edit / delete</strong> to open the controlled project setup record.</p>
    </div>
  );
}
