"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Eye,
  ExternalLink,
  FileText,
  Loader2,
  Scale,
  Tent,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const LLC_RECOMMENDATION = {
  no_action: { label: "No action", icon: "\u26aa", color: "#6b7280" },
  monitor: { label: "Monitor", icon: "\ud83d\udfe1", color: "#b0972e" },
  update_llc: { label: "Update LLC", icon: "\ud83d\udfe0", color: "#c98a1e" },
  immediate_procedure_change: { label: "Immediate procedure change", icon: "\ud83d\udd34", color: "#a5342a" },
};

const STATUS_LABEL = {
  commenced_law: "Commenced law",
  made_not_commenced: "Made, not commenced",
  adopted_policy: "Adopted policy",
  formal_guidance: "Formal guidance",
  draft_exhibited: "Draft / exhibited",
  consultation_proposal: "Consultation proposal",
  emerging_practice: "Emerging practice",
  system_admin_change: "System / admin change",
};

const MATRIX_DOT = { green: "#2c6a34", amber: "#c98a1e", red: "#a5342a" };

function formatWeek(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : `Week of ${date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
}

function DevelopmentCard({ development }) {
  const [expanded, setExpanded] = useState(development.llc_recommendation === "immediate_procedure_change");
  const cls = LLC_RECOMMENDATION[development.llc_recommendation] || LLC_RECOMMENDATION.monitor;
  const implications = development.consulting_implications || {};
  const hasImplications = Object.values(implications).some(Boolean);

  return (
    <div className="lg-development" style={{ borderLeftColor: cls.color }}>
      <div className="lg-development-head">
        <span className="lg-classification" style={{ background: `${cls.color}1a`, color: cls.color, borderColor: `${cls.color}55` }}>{cls.icon} {cls.label}</span>
        {development.severity ? <span className="lg-severity-tag">{development.severity}</span> : null}
        <span className="lg-development-cat">{development.category}</span>
        <span className="lg-development-juris">{development.jurisdiction}</span>
      </div>
      <h4>{development.title}</h4>
      {development.llc_reasoning ? <p className="lg-reasoning"><strong>Why:</strong> {development.llc_reasoning}</p> : null}

      {/* Level 1 — always visible, the whole point is a field ecologist needs nothing more */}
      {development.level1_notification ? <p className="lg-level1">{development.level1_notification}</p> : null}

      {Array.isArray(development.affected_work) && development.affected_work.length ? (
        <div className="lg-affected-work">
          {development.affected_work.map((w) => <span key={w}>{w}</span>)}
        </div>
      ) : null}

      <button type="button" className="lg-expand-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {expanded ? "Hide" : "Show"} detail & evidence
      </button>

      {expanded ? (
        <div className="lg-level2">
          {development.what_changed ? (
            <div className="lg-development-block"><strong>What changed</strong><p>{development.what_changed}</p></div>
          ) : null}
          <div className="lg-development-dates">
            {development.published_date ? <span>Published {development.published_date}</span> : null}
            {development.effective_date ? <span>Effective {development.effective_date}</span> : null}
            {development.applies_from ? <span>Applies from: {development.applies_from}</span> : null}
          </div>
          {development.transitional_treatment ? (
            <div className="lg-development-block"><strong>Transitional treatment</strong><p>{development.transitional_treatment}</p></div>
          ) : null}

          {hasImplications ? (
            <div className="lg-development-block">
              <strong>Consulting implications</strong>
              {implications.quotes ? <p><em>Quotes:</em> {implications.quotes}</p> : null}
              {implications.scoping ? <p><em>Scoping:</em> {implications.scoping}</p> : null}
              {implications.reports ? <p><em>Reports:</em> {implications.reports}</p> : null}
              {implications.project_program ? <p><em>Project program:</em> {implications.project_program}</p> : null}
            </div>
          ) : null}

          {Array.isArray(development.affected_projects) && development.affected_projects.length ? (
            <div className="lg-development-block action">
              <strong><Briefcase size={13} /> Projects potentially affected</strong>
              {development.affected_projects.map((p, i) => (
                <p key={i}><strong>{p.project_name}</strong>{p.owner ? ` — ${p.owner}` : ""}: {p.action}</p>
              ))}
            </div>
          ) : null}

          {development.recommended_action ? (
            <div className="lg-development-block action">
              <strong><CheckCircle2 size={13} /> Action</strong>
              <p>{development.recommended_action}</p>
            </div>
          ) : null}

          {development.conflict_note ? (
            <div className="lg-development-block conflict">
              <strong><AlertTriangle size={13} /> Sources conflicted</strong>
              <p>{development.conflict_note}</p>
            </div>
          ) : null}

          {Array.isArray(development.triggers_fired) && development.triggers_fired.length ? (
            <div className="lg-triggers">Triggers: {development.triggers_fired.join(", ")} · {STATUS_LABEL[development.legal_status] || development.legal_status}</div>
          ) : null}

          {Array.isArray(development.sources) && development.sources.length ? (
            <div className="lg-development-sources">
              {development.sources.map((source, index) => (
                <a key={index} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> {source.title || "Source"}{source.tier ? ` (Tier ${source.tier})` : ""}</a>
              ))}
            </div>
          ) : null}
          <p className="lg-disclaimer">AI-generated operational interpretation — not a legal or regulatory determination.</p>
        </div>
      ) : null}
    </div>
  );
}

function StatusMatrix({ rows }) {
  if (!rows?.length) return null;
  return (
    <table className="lg-matrix">
      <thead><tr><th>Area</th><th>Status</th><th>Impact</th></tr></thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{row.area}</td>
            <td><span className="lg-matrix-dot" style={{ background: MATRIX_DOT[row.status] || "#8a927c" }} /></td>
            <td>{row.impact}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DEPARTMENT_ICONS = { fieldwork: Tent, reporting: FileText, quoting: ClipboardList, approvals: Scale };
const DEPARTMENT_LABELS = { fieldwork: "Fieldwork", reporting: "Reporting", quoting: "Quoting", approvals: "Approvals" };

export default function Legis({ compact = false }) {
  const { session } = useAuth();
  const [brief, setBrief] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/legis", { headers: headers() })
      .then((response) => response.json())
      .then((data) => setBrief(data.brief || null))
      .catch(() => setError("Could not load this week's Legis brief."))
      .finally(() => setLoading(false));
  }, [session?.access_token, headers]);

  const loadHistory = () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    if (history.length) return;
    fetch("/api/legis?history=true", { headers: headers() })
      .then((response) => response.json())
      .then((data) => setHistory(data.briefs || []));
  };

  if (loading) return <div className="lg-loading"><Loader2 size={16} className="spin" /> Loading Legis…</div>;
  if (error) return <p className="lg-error"><AlertCircle size={14} /> {error}</p>;

  if (!brief || brief.status !== "ready") {
    return (
      <div className="lg-empty">
        <Scale size={20} />
        <strong>{brief?.status === "generating" ? "This week's briefing is being researched" : "No briefing yet"}</strong>
        <span>{brief?.status === "generating" ? "Check back shortly — it's compiled every Monday morning." : "The first Legis briefing will appear here once generated."}</span>
      </div>
    );
  }

  const developments = brief.developments || [];
  const actionItems = developments.filter((d) => d.llc_recommendation === "immediate_procedure_change");
  const otherItems = developments.filter((d) => d.llc_recommendation !== "immediate_procedure_change");
  const departments = brief.department_summaries || {};
  const hasDepartments = Object.values(departments).some(Boolean);

  return (
    <div className={`lg${compact ? " lg-compact" : ""}`}>
      <style>{`
        .lg { background: #E5E7EB; color: #0F172A; padding: 16px; border-radius: 10px; }
        .lg h3 { color: #001F54; font-weight: 700; }
        .lg-header span { color: #001F54; font-weight: 700; display: flex; align-items: center; gap: 6px; }
        .lg-summary { color: #0F172A; font-size: 13.5px; line-height: 1.55; }
        .lg-development { border: 1px solid #cbd0d8; border-left: 4px solid; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
        .lg-development-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .lg-classification { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 6px; border: 1px solid; }
        .lg-severity-tag { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 700; color: #4b5563; }
        .lg-development-cat, .lg-development-juris { font-size: 11px; color: #4b5563; }
        .lg-development h4 { margin: 0 0 6px; font-size: 14.5px; color: #001F54; }
        .lg-level1 { margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: #0F172A; font-weight: 500; }
        .lg-affected-work { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
        .lg-affected-work span { font-size: 10.5px; background: #E5E7EB; color: #0F172A; padding: 2px 8px; border-radius: 10px; }
        .lg-expand-toggle { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; color: #001F54; font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }
        .lg-level2 { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #cbd0d8; }
        .lg-development p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.5; color: #0F172A; }
        .lg-development-dates { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: #4b5563; margin-bottom: 8px; }
        .lg-development-block { background: #f3f4f6; border-radius: 7px; padding: 8px 10px; margin-bottom: 6px; }
        .lg-development-block.action { background: #eaf6ea; }
        .lg-development-block.conflict { background: #fdf3e8; }
        .lg-development-block strong { display: flex; align-items: center; gap: 5px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #166534; margin-bottom: 3px; }
        .lg-development-block.conflict strong { color: #b45309; }
        .lg-triggers { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #6b7280; margin-bottom: 6px; }
        .lg-development-sources { display: flex; gap: 12px; flex-wrap: wrap; margin: 6px 0; }
        .lg-development-sources a { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #001F54; text-decoration: none; }
        .lg-disclaimer { font-size: 10.5px; color: #6b7280; font-style: italic; margin: 6px 0 0; }
        .lg-loading, .lg-error { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #0F172A; padding: 16px; }
        .lg-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 30px 20px; color: #4b5563; }
        .lg-matrix { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 10px 0 16px; background: #fff; border-radius: 8px; overflow: hidden; }
        .lg-matrix th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #4b5563; padding: 6px 10px; border-bottom: 1px solid #cbd0d8; }
        .lg-matrix td { padding: 6px 10px; border-bottom: 1px solid #eceff3; color: #0F172A; }
        .lg-matrix-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
        .lg-departments { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 10px 0 16px; }
        .lg-dept-card { border: 1px solid #cbd0d8; border-radius: 8px; padding: 10px 12px; background: #fff; }
        .lg-dept-card strong { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #001F54; margin-bottom: 4px; }
        .lg-dept-card p { margin: 0; font-size: 12px; color: #0F172A; }
        /* Actions Required — green, per the requested colour scheme */
        .lg-actions { background: #eaf6ea; border: 1px solid #bde0bd; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }
        .lg-actions h3 { color: #166534; }
        .lg-actions ul { margin: 4px 0 0; padding-left: 18px; }
        .lg-actions li { color: #14532d; font-size: 12.5px; line-height: 1.6; }
        /* Watchlist — amber/orange, per the requested colour scheme */
        .lg-reasoning { background: #f3f4f6; border-radius: 6px; padding: 6px 10px; font-size: 12px; color: #374151; margin-bottom: 8px; }
        .lg-reasoning strong { color: #001F54; text-transform: none; letter-spacing: 0; font-size: 12px; }
        .lg-watch-item { background: #fef3e2; border: 1px solid #f5cb87; border-left: 3px solid #b45309; border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
        .lg-watch-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .lg-watch-meta { display: flex; gap: 10px; font-size: 11px; color: #92400e; margin: 3px 0; }
        .lg-likelihood { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
        .lg-likelihood-high { background: #fde2e1; color: #a5342a; }
        .lg-likelihood-medium { background: #fdecc8; color: #92400e; }
        .lg-likelihood-low { background: #e5e7eb; color: #4b5563; }
        .lg-watch-item strong { color: #92400e; font-size: 12.5px; }
        .lg-watch-item p { margin: 4px 0; font-size: 12px; color: #78350f; }
        .lg-watch-item small { color: #92400e; display: flex; align-items: center; gap: 4px; }
        .lg-carried-forward { font-style: italic; }
        .lg-no-change { font-size: 12px; color: #4b5563; margin-top: 10px; }
        .lg-history-toggle { background: none; border: none; color: #001F54; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 0; margin-top: 10px; }
        .lg-history-item { background: #fff; border: 1px solid #cbd0d8; border-radius: 8px; padding: 8px 12px; margin-top: 8px; }
        .lg-history-item strong { color: #001F54; font-size: 12px; }
        .lg-history-item p { margin: 4px 0 0; font-size: 12px; color: #0F172A; }
      `}</style>


      <div className="lg-header"><span><Scale size={13} /> {formatWeek(brief.week_of)}</span></div>
      {brief.summary ? <p className="lg-summary">{brief.summary}</p> : null}

      <StatusMatrix rows={brief.status_matrix} />

      {actionItems.length ? (
        <section>
          <h3>{"\ud83d\udd34"} Immediate procedure change ({actionItems.length})</h3>
          {actionItems.map((d, i) => <DevelopmentCard key={i} development={d} />)}
        </section>
      ) : null}

      {otherItems.length ? (
        <section>
          <h3><BookOpen size={15} /> Other developments</h3>
          {otherItems.map((d, i) => <DevelopmentCard key={i} development={d} />)}
        </section>
      ) : null}

      {!developments.length ? <p className="lg-no-developments">No developments met the consequentiality threshold this week.</p> : null}

      {hasDepartments ? (
        <section>
          <h3>Cross-cutting impact</h3>
          <div className="lg-departments">
            {Object.entries(departments).filter(([, text]) => text).map(([key, text]) => {
              const Icon = DEPARTMENT_ICONS[key] || FileText;
              return (
                <div key={key} className="lg-dept-card">
                  <strong><Icon size={13} /> {DEPARTMENT_LABELS[key] || key}</strong>
                  <p>{text}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {(brief.actions_this_week || []).length ? (
        <section className="lg-actions">
          <h3><CheckCircle2 size={15} /> Actions for this week</h3>
          <ul>{brief.actions_this_week.map((action, index) => <li key={index}>{action}</li>)}</ul>
        </section>
      ) : null}

      {(brief.watchlist || []).length ? (
        <section>
          <h3><Eye size={15} /> Regulatory Watchlist</h3>
          {brief.watchlist.map((item, index) => (
            <div key={index} className="lg-watch-item">
              <div className="lg-watch-head">
                <strong>{item.issue}</strong>
                {item.likelihood ? <span className={`lg-likelihood lg-likelihood-${String(item.likelihood).toLowerCase()}`}>{item.likelihood} likelihood</span> : null}
              </div>
              <div className="lg-watch-meta">
                {item.jurisdiction ? <span>{item.jurisdiction}</span> : null}
                {item.current_status ? <span>{STATUS_LABEL[item.current_status] || item.current_status}</span> : null}
              </div>
              {item.potential_impact ? <p>{item.potential_impact}</p> : null}
              {item.carried_forward_note ? <p className="lg-carried-forward">Since last week: {item.carried_forward_note}</p> : null}
              {item.next_milestone_date ? <small><CalendarClock size={11} /> Next milestone: {item.next_milestone_date}</small> : null}
            </div>
          ))}
        </section>
      ) : null}

      {(brief.no_material_change_categories || []).length ? (
        <p className="lg-no-change">No material change this week: {brief.no_material_change_categories.join(", ")}.</p>
      ) : null}

      <button type="button" className="lg-history-toggle" onClick={loadHistory}>
        {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Previous briefings
      </button>
      {showHistory ? (
        <div className="lg-history">
          {history.filter((item) => item.id !== brief.id).map((item) => (
            <div key={item.id} className="lg-history-item">
              <strong>{formatWeek(item.week_of)}</strong>
              <p>{item.summary}</p>
            </div>
          ))}
          {history.length <= 1 ? <p className="lg-empty-inline">No earlier briefings yet.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
