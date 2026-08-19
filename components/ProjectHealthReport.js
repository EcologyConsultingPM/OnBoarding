"use client";

import { useEffect, useState } from "react";
import { BarChart3, AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

function money(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

export default function ProjectHealthReport() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const res = await fetch("/api/project-health-report", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Could not load the report.");
        setData(payload);
      } catch (e) { setError(e.message); }
    })();
  }, [session]);

  if (error) return <div className="phr"><p className="phr-error"><AlertCircle size={15} /> {error}</p></div>;
  if (!data) return <div className="phr"><p style={{ color: "#6b755f", fontWeight: 600 }}>Loading report…</p></div>;

  const { summary, rows } = data;

  return (
    <div className="phr">
      <header className="phr-hero">
        <span><BarChart3 size={17} /> Reporting & analytics · Admin only</span>
        <h1>Project health report</h1>
        <p>Portfolio rollup across active projects. Task completion, current spend and remaining budget are collated from project setup and activity status. Actual timesheet hours come from the external timesheet system.</p>
      </header>

      <div className="phr-summary">
        <div className="phr-sum-card"><div className="phr-sum-value">{summary.active}</div><div className="phr-sum-label">Active projects</div></div>
        <div className="phr-sum-card"><div className="phr-sum-value" style={{ color: "#2c6a34" }}>{summary.onTrack}</div><div className="phr-sum-label">On track</div></div>
        <div className="phr-sum-card"><div className="phr-sum-value" style={{ color: "#c0392b" }}>{summary.atRisk}</div><div className="phr-sum-label">At risk</div></div>
        <div className="phr-sum-card"><div className="phr-sum-value">{summary.avgCompletion}%</div><div className="phr-sum-label">Avg completion</div></div>
      </div>

      {rows.length ? (
        <div className="phr-table-wrap">
          <table className="phr-table">
            <thead>
              <tr>
                <th>Client</th><th>Project</th><th>Task completion</th><th>Team</th>
                <th>Current spend</th><th>Remaining hrs</th><th>Remaining budget</th><th>Health</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.client}</td>
                  <td className="phr-proj">{r.project}</td>
                  <td>
                    <div className="phr-bar"><div className="phr-bar-fill" style={{ width: `${r.taskCompletion}%`, background: r.health === "At Risk" ? "#c0392b" : "#3d7a35" }} /></div>
                    <span className="phr-pct">{r.taskCompletion}%</span>
                  </td>
                  <td>{r.teamSize}</td>
                  <td>{money(r.currentSpend)}</td>
                  <td>{r.remainingHours ?? "—"}</td>
                  <td>{r.remainingBudget != null ? money(r.remainingBudget) : "—"}</td>
                  <td>
                    <span className={r.health === "At Risk" ? "phr-health risk" : "phr-health ok"}>
                      {r.health === "At Risk" ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {r.health}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="phr-empty">No active projects to report on yet. Create and set up projects to populate the report.</p>}

      <p className="phr-note">
        Health is flagged <strong>At Risk</strong> when budget hours or dollars are exceeded, or an activity is paused / awaiting information. Spend-to-date is derived from completed-activity hours until the external timesheet feed is connected.
      </p>
    </div>
  );
}
