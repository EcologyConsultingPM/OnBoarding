"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Download, ListFilter, Loader2, WalletCards } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import ProjectTrackerExport from "./ProjectTrackerExport";

function money(value) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function displayHours(value) { return value == null ? "—" : `${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(value)} h`; }
function score(project) { const budget = project.financials?.overallBudget || 0; const spend = project.financials?.chargeOutSpend || 0; const hours = project.financials?.budgetHours || 0; const used = project.financials?.usedHours || 0; return Math.max(budget ? (spend / budget) * 100 : 0, hours ? (used / hours) * 100 : 0); }

export default function ProjectHealthReport({ onManageProject, onOpenProjectTracker }) {
  const { session } = useAuth();
  const [projects, setProjects] = useState([]);
  const [financialReady, setFinancialReady] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ client: "", health: "", sort: "risk_first" });
  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    let active = true;
    (async () => { try { const response = await fetch("/api/admin/project-tracker", { headers: headers(), cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load Project Health Report."); if (active) { setProjects(body.projects || []); setFinancialReady(Boolean(body.financialReady)); } } catch (loadError) { if (active) setError(loadError.message || "Could not load Project Health Report."); } finally { if (active) setLoading(false); } })();
    return () => { active = false; };
  }, [headers, session?.access_token]);

  const clients = useMemo(() => [...new Set(projects.map((project) => project.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [projects]);
  const rows = useMemo(() => projects.filter((project) => (!filters.client || project.clientName === filters.client) && (!filters.health || project.health === filters.health)).sort((left, right) => {
    if (filters.sort === "client") return `${left.clientName} ${left.name}`.localeCompare(`${right.clientName} ${right.name}`);
    if (filters.sort === "completion_desc") return right.taskCompletion - left.taskCompletion;
    if (filters.sort === "completion_asc") return left.taskCompletion - right.taskCompletion;
    if (filters.sort === "spend_desc") return Number(right.financials?.chargeOutSpend || 0) - Number(left.financials?.chargeOutSpend || 0);
    if (filters.sort === "profit_desc") return Number(right.financials?.estimatedProfit || 0) - Number(left.financials?.estimatedProfit || 0);
    const rank = { "At Risk": 0, Watch: 1, "On Track": 2 }; return (rank[left.health] ?? 9) - (rank[right.health] ?? 9) || left.name.localeCompare(right.name);
  }), [filters, projects]);
  const summary = useMemo(() => ({
    active: projects.length,
    atRisk: projects.filter((project) => project.health === "At Risk").length,
    onTrack: projects.filter((project) => project.health === "On Track").length,
    watch: projects.filter((project) => project.health === "Watch").length,
    averageProfit: projects.length ? projects.reduce((sum, project) => sum + Number(project.financials?.estimatedProfit || 0), 0) / projects.length : 0,
    availableHours: projects.reduce((sum, project) => sum + Number(project.financials?.remainingHours || 0), 0),
    averageUtilisation: projects.length ? projects.reduce((sum, project) => sum + Number(project.financials?.utilisationPercent || 0), 0) / projects.length : 0,
    averageDeliveryDays: (() => { const values = projects.map((project) => project.activitySummary?.averageDeliveryDays).filter((value) => Number.isFinite(value)); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; })(),
    followUps: projects.reduce((sum, project) => sum + Number(project.activitySummary?.paused || 0) + Number(project.activitySummary?.overdue || 0) + Number(project.activitySummary?.atRiskAllocations || 0), 0),
  }), [projects]);
  const attention = useMemo(() => ({ overHours: projects.filter((project) => (project.financials?.remainingHours ?? 0) < 0).length, threshold: projects.reduce((sum, project) => sum + Number(project.activitySummary?.watchAllocations || 0), 0), paused: projects.reduce((sum, project) => sum + Number(project.activitySummary?.paused || 0), 0) }), [projects]);

  if (loading) return <section className="phr"><div className="phr-loading"><Loader2 className="spin" size={18} /> Calculating active project health…</div></section>;
  if (error) return <section className="phr"><p className="phr-error"><AlertCircle size={15} /> {error}</p></section>;
  return <section className="phr" aria-label="Project Health Report"><header className="phr-hero"><div><span><BarChart3 size={16} /> Portfolio control · live project tracker data</span><h1>Project Health Report</h1><p>Screen the delivery, financial and resource condition of every active Project Tracker. Select a project to inspect its tracker and controlled budget allocations.</p></div><ProjectTrackerExport scope="portfolio" /></header>
    {!financialReady ? <div className="phr-notice"><AlertCircle size={16} /> Financial tracker fields are awaiting the approved additive tracker migration. Project delivery health remains available from current activity records.</div> : null}
    <div className="phr-summary extended"><SumCard label="Active projects" value={summary.active} icon={<WalletCards size={18} />} /><SumCard label="At risk" value={summary.atRisk} tone="risk" icon={<AlertTriangle size={18} />} /><SumCard label="On track" value={summary.onTrack} tone="good" icon={<CheckCircle2 size={18} />} /><SumCard label="Average est. profit" value={money(summary.averageProfit)} icon={<WalletCards size={18} />} /><SumCard label="Average utilisation" value={`${Math.round(summary.averageUtilisation)}%`} tone={summary.averageUtilisation >= 90 ? "risk" : summary.averageUtilisation >= 80 ? "gold" : "good"} icon={<BarChart3 size={18} />} /><SumCard label="Average delivery" value={summary.averageDeliveryDays == null ? "—" : `${Math.round(summary.averageDeliveryDays)} days`} icon={<CheckCircle2 size={18} />} /><SumCard label="Available hours" value={displayHours(summary.availableHours)} tone={summary.availableHours < 0 ? "risk" : ""} icon={<BarChart3 size={18} />} /><SumCard label="Follow-ups required" value={summary.followUps} tone={summary.followUps ? "gold" : "good"} icon={<AlertCircle size={18} />} /></div>
    <section className="phr-controls" aria-label="Project Health Report controls"><div className="phr-controls-title"><ListFilter size={15} /><span>Filter active project health</span><b>{rows.length} of {projects.length}</b></div><div className="phr-controls-fields"><label>Client<select value={filters.client} onChange={(event) => setFilters({ ...filters, client: event.target.value })}><option value="">All clients</option>{clients.map((client) => <option key={client} value={client}>{client}</option>)}</select></label><label>Health<select value={filters.health} onChange={(event) => setFilters({ ...filters, health: event.target.value })}><option value="">All health states</option><option value="On Track">On track</option><option value="Watch">Watch</option><option value="At Risk">At risk</option></select></label><label>Sort by<select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}><option value="risk_first">Risk first</option><option value="completion_desc">Completion · high to low</option><option value="completion_asc">Completion · low to high</option><option value="spend_desc">Charge-out spend · high to low</option><option value="profit_desc">Estimated profit · high to low</option><option value="client">Client / project · A–Z</option></select></label><button type="button" className="phr-clear-controls" onClick={() => setFilters({ client: "", health: "", sort: "risk_first" })}>Clear</button></div></section>
    <div className="phr-grid"><section className="phr-table-card"><div className="phr-table-title"><div><span className="phr-kicker">Active project health</span><h2>Portfolio tracker overview</h2></div><span>{financialReady ? "Financials active" : "Delivery health active"}</span></div>{rows.length ? <div className="phr-table-wrap"><table className="phr-table"><thead><tr><th>Client</th><th>Project</th><th>Completion</th><th>Utilisation</th><th>Profitability</th><th>Average delivery</th><th>Remaining hours</th><th>Health</th><th /></tr></thead><tbody>{rows.map((project) => <tr key={project.id}><td>{project.clientName}</td><td className="phr-proj"><strong>{project.name}</strong><small>{project.teamCount} allocated staff · {project.trackerVisible ? "Tracker visible" : "Tracker not enabled"}</small></td><td><div className="phr-bar"><div className="phr-bar-fill" style={{ width: `${project.taskCompletion}%`, background: project.health === "At Risk" ? "#dc776f" : project.health === "Watch" ? "#d5a939" : "#78bd74" }} /></div><span className="phr-pct">{project.taskCompletion}%</span></td><td>{project.financials?.utilisationPercent == null ? "—" : `${project.financials.utilisationPercent}%`}</td><td>{project.financials?.profitabilityPercent == null ? "—" : `${project.financials.profitabilityPercent}%`}</td><td>{project.activitySummary?.averageDeliveryDays == null ? "—" : `${project.activitySummary.averageDeliveryDays} d`}</td><td className={(project.financials?.remainingHours ?? 0) < 0 ? "phr-negative" : ""}>{displayHours(project.financials?.remainingHours)}</td><td><HealthBadge health={project.health} /></td><td><div className="phr-actions"><button type="button" onClick={() => onOpenProjectTracker?.(project.id)}>Review tracker <ChevronRight size={13} /></button><button type="button" onClick={() => onManageProject?.(project.id)}>Edit project</button></div></td></tr>)}</tbody></table></div> : <p className="phr-empty">No active projects match the selected filters.</p>}</section>
      <aside className="phr-side"><section><span className="phr-kicker">Needs attention</span><h2>Portfolio actions</h2><Attention label={`${attention.overHours} project${attention.overHours === 1 ? " has" : "s have"} exceeded planned hours`} tone="risk" /><Attention label={`${attention.threshold} allocation${attention.threshold === 1 ? " is" : "s are"} approaching threshold`} tone="gold" /><Attention label={`${attention.paused} delivery entr${attention.paused === 1 ? "y is" : "ies are"} paused, overdue or awaiting information`} tone="good" /></section><section><span className="phr-kicker">Health drivers</span><h2>Portfolio pressure</h2><Driver label="Budget burn" value={average(projects.map((project) => score(project)))} tone="gold" /><Driver label="Task progress" value={average(projects.map((project) => project.taskCompletion))} tone="good" /><Driver label="On-track projects" value={projects.length ? Math.round((summary.onTrack / projects.length) * 100) : 0} tone="moss" /></section></aside></div>
  </section>;
}
function SumCard({ label, value, tone = "", icon }) { return <div className={`phr-sum-card ${tone}`}><span className="phr-sum-icon">{icon}</span><div><div className="phr-sum-label">{label}</div><div className="phr-sum-value">{value}</div></div></div>; }
function HealthBadge({ health }) { const risk = health === "At Risk"; return <span className={`phr-health ${risk ? "risk" : health === "Watch" ? "watch" : "ok"}`}>{risk ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}{health}</span>; }
function Attention({ label, tone }) { return <div className={`phr-attention ${tone}`}><span>{tone === "risk" ? <AlertTriangle size={14} /> : tone === "gold" ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}</span><p>{label}</p></div>; }
function Driver({ label, value, tone }) { return <div className={`phr-driver ${tone}`}><div><span>{label}</span><b>{Math.round(value || 0)}%</b></div><i><strong style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></i></div>; }
function average(values) { return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0; }
