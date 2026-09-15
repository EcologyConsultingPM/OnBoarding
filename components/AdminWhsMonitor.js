"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Clock, FileWarning, Users, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import WhsComplianceDashboard from "./WhsComplianceDashboard";

export default function AdminWhsMonitor() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [personSort, setPersonSort] = useState("total"); // total | name | approved

  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const res = await fetch("/api/whs-monitor", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "Could not load the WHS dashboard.");
        setData(payload);
      } catch (e) { setError(e.message); }
    })();
  }, [session?.access_token]);

  if (error) return <div className="wm"><p className="wm-error"><AlertCircle size={15} /> {error}</p></div>;
  if (!data) return <div className="wm"><p style={{ color: "#6b755f", fontWeight: 600 }}>Loading WHS dashboard…</p></div>;

  const { summary, byStatus, awaiting, people } = data;

  const kinds = ["all", ...Array.from(new Set(awaiting.map((a) => a.kind)))];
  const visibleAwaiting = kindFilter === "all" ? awaiting : awaiting.filter((a) => a.kind === kindFilter);
  const sortedPeople = [...people].sort((a, b) => {
    if (personSort === "name") return (a.email || "").localeCompare(b.email || "");
    if (personSort === "approved") return b.approved - a.approved;
    return (b.drafts + b.talks + b.incidents) - (a.drafts + a.talks + a.incidents);
  });

  return (
    <div className="wm">
      <header className="wm-hero">
        <span><ShieldCheck size={17} /> Safety & governance · Admin</span>
        <h1>WHS monitoring</h1>
        <p>Oversight of WHS records across the team — controlled drafts, toolbox talks and incident reports. See what's awaiting review and what each person has submitted.</p>
      </header>

      <div className="wm-summary">
        <div className="wm-sum"><div className="wm-sum-v">{summary.totalDrafts}</div><div className="wm-sum-l">Controlled drafts</div></div>
        <div className="wm-sum"><div className="wm-sum-v">{summary.totalTalks}</div><div className="wm-sum-l">Toolbox talks</div></div>
        <div className="wm-sum"><div className="wm-sum-v">{summary.totalIncidents}</div><div className="wm-sum-l">Incident reports</div></div>
        <div className="wm-sum"><div className="wm-sum-v" style={{ color: summary.awaitingReview ? "#b08948" : "#2c6a34" }}>{summary.awaitingReview}</div><div className="wm-sum-l">Awaiting review</div></div>
      </div>

      {/* Awaiting review / approval queue */}
      <section className="wm-card">
        <div className="wm-card-head">
          <h2><Clock size={16} /> Awaiting review &amp; approval</h2>
          {kinds.length > 1 && (
            <select className="wm-filter" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              {kinds.map((k) => <option key={k} value={k}>{k === "all" ? "All types" : k}</option>)}
            </select>
          )}
        </div>
        {visibleAwaiting.length ? (
          <div className="wm-queue">
            {visibleAwaiting.map((a) => (
              <div key={a.id} className="wm-queue-row">
                <span className="wm-kind">{a.kind}</span>
                <span className="wm-title">{a.title}</span>
                <span className="wm-author">{a.author}</span>
                <span className="wm-date">{a.updated_at ? new Date(a.updated_at).toLocaleDateString("en-AU") : "—"}</span>
              </div>
            ))}
          </div>
        ) : <p className="wm-empty">Nothing awaiting review. All submitted WHS records have been actioned.</p>}
      </section>

      {/* Status breakdown */}
      <section className="wm-card">
        <h2><FileWarning size={16} /> Status breakdown</h2>
        <div className="wm-status-grid">
          {[
            { label: "Controlled drafts", c: byStatus.drafts },
            { label: "Toolbox talks", c: byStatus.talks },
            { label: "Incident reports", c: byStatus.incidents },
          ].map((row) => (
            <div key={row.label} className="wm-status-row">
              <div className="wm-status-label">{row.label}</div>
              <div className="wm-chips">
                <span className="wm-chip draft">{row.c.draft || 0} draft</span>
                <span className="wm-chip review">{row.c.ready_for_review || 0} in review</span>
                <span className="wm-chip approved">{row.c.approved || 0} approved</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Per-person completion */}
      <section className="wm-card">
        <h2><Users size={16} /> By team member</h2>
        {people.length ? (
          <div className="wm-table-wrap">
            <table className="wm-table">
              <thead><tr><th>Team member</th><th>Drafts</th><th>Toolbox talks</th><th>Incidents</th><th>Approved</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.email}>
                    <td className="wm-person">{p.email}</td>
                    <td>{p.drafts}</td>
                    <td>{p.talks}</td>
                    <td>{p.incidents}</td>
                    <td><span className="wm-approved">{p.approved}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="wm-empty">No WHS records submitted yet.</p>}
      </section>

      <WhsComplianceDashboard />

      <p className="wm-note">
        This dashboard monitors WHS records and field-form submissions in the system. Every staff submission is captured here for compliance auditing.
      </p>
    </div>
  );
}
