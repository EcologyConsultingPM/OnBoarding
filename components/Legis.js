"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  ExternalLink,
  Loader2,
  Scale,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS_LABEL = {
  commenced_law: { label: "Commenced law", color: "#1f5a34" },
  made_not_commenced: { label: "Made, not commenced", color: "#2c6a34" },
  adopted_policy: { label: "Adopted policy", color: "#2c6a34" },
  formal_guidance: { label: "Formal guidance", color: "#1d7d8c" },
  draft_exhibited: { label: "Draft / exhibited", color: "#c98a1e" },
  consultation_proposal: { label: "Consultation proposal", color: "#c98a1e" },
  emerging_practice: { label: "Emerging practice", color: "#8a927c" },
  system_admin_change: { label: "System / admin change", color: "#5c6b52" },
};

const SEVERITY_COLOR = { HIGH: "#a5342a", MEDIUM: "#c98a1e", LOW: "#6b755f" };

function formatWeek(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : `Week of ${date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
}

function DevelopmentCard({ development }) {
  const status = STATUS_LABEL[development.legal_status] || { label: development.legal_status || "Unknown", color: "#8a927c" };
  const severityColor = SEVERITY_COLOR[development.severity] || "#6b755f";
  return (
    <div className="lg-development">
      <div className="lg-development-head">
        {development.severity ? <span className="lg-severity" style={{ background: `${severityColor}1a`, color: severityColor, borderColor: `${severityColor}55` }}>{development.severity}</span> : null}
        <span className="lg-development-badge" style={{ background: `${status.color}1a`, color: status.color, borderColor: `${status.color}55` }}>{status.label}</span>
        <span className="lg-development-cat">{development.category}</span>
        <span className="lg-development-juris">{development.jurisdiction}</span>
      </div>
      <h4>{development.title}</h4>
      {development.what_changed ? <p>{development.what_changed}</p> : null}
      <div className="lg-development-dates">
        {development.published_date ? <span>Published {development.published_date}</span> : null}
        {development.effective_date ? <span>Effective {development.effective_date}</span> : null}
        {development.applies_from ? <span>Applies from: {development.applies_from}</span> : null}
      </div>
      {development.transitional_treatment ? (
        <div className="lg-development-block">
          <strong>Transitional treatment</strong>
          <p>{development.transitional_treatment}</p>
        </div>
      ) : null}
      {development.projects_affected ? (
        <div className="lg-development-block">
          <strong>Projects affected</strong>
          <p>{development.projects_affected}</p>
        </div>
      ) : null}
      {development.practical_consequences ? (
        <div className="lg-development-block">
          <strong>Why it matters commercially</strong>
          <p>{development.practical_consequences}</p>
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
        <div className="lg-triggers">Triggers: {development.triggers_fired.join(", ")}</div>
      ) : null}
      {Array.isArray(development.sources) && development.sources.length ? (
        <div className="lg-development-sources">
          {development.sources.map((source, index) => (
            <a key={index} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> {source.title || "Source"}{source.tier ? ` (Tier ${source.tier})` : ""}</a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

  return (
    <div className={`lg${compact ? " lg-compact" : ""}`}>
      <style>{`
        .lg-development { border: 1px solid #e3ded2; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
        .lg-development-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .lg-severity, .lg-development-badge { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 3px 8px; border-radius: 5px; border: 1px solid; }
        .lg-development-cat, .lg-development-juris { font-size: 11px; color: #6b755f; }
        .lg-development h4 { margin: 0 0 6px; font-size: 14.5px; color: #12211a; }
        .lg-development p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.5; color: #3a4740; }
        .lg-development-dates { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: #5c6b52; margin-bottom: 8px; }
        .lg-development-block { background: #f7f8f2; border-radius: 7px; padding: 8px 10px; margin-bottom: 6px; }
        .lg-development-block.action { background: #eef6ea; }
        .lg-development-block.conflict { background: #fdf3e8; }
        .lg-development-block strong { display: flex; align-items: center; gap: 5px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #2c6a34; margin-bottom: 3px; }
        .lg-development-block.conflict strong { color: #a5670f; }
        .lg-triggers { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #8a927c; margin-bottom: 6px; }
        .lg-development-sources { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
        .lg-development-sources a { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #1d7d8c; text-decoration: none; }
        .lg-loading, .lg-error { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b755f; padding: 16px; }
        .lg-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 30px 20px; color: #6b755f; }
      `}</style>
      <div className="lg-header">
        <span><Scale size={13} /> {formatWeek(brief.week_of)}</span>
      </div>
      {brief.summary ? <p className="lg-summary">{brief.summary}</p> : null}

      {(brief.developments || []).length ? (
        <section>
          <h3><BookOpen size={15} /> Developments</h3>
          {brief.developments.map((development, index) => <DevelopmentCard key={index} development={development} />)}
        </section>
      ) : (
        <p className="lg-no-developments">No developments met the consequentiality threshold this week.</p>
      )}

      {(brief.actions_this_week || []).length ? (
        <section className="lg-actions">
          <h3><CheckCircle2 size={15} /> Actions for this week</h3>
          <ul>{brief.actions_this_week.map((action, index) => <li key={index}>{action}</li>)}</ul>
        </section>
      ) : null}

      {(brief.watchlist || []).length ? (
        <section>
          <h3><Eye size={15} /> Watchlist</h3>
          {brief.watchlist.map((item, index) => (
            <div key={index} className="lg-watch-item">
              <strong>{item.title}</strong>
              {item.status_label ? <span className="lg-watch-status">{STATUS_LABEL[item.status_label]?.label || item.status_label}</span> : null}
              <p>{item.why_it_matters}</p>
              {item.carried_forward_note ? <p className="lg-carried-forward">Since last week: {item.carried_forward_note}</p> : null}
              {item.expected_timing ? <small><CalendarClock size={11} /> {item.expected_timing}</small> : null}
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
