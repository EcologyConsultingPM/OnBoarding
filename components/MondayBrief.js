"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  ExternalLink,
  Loader2,
  Newspaper,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS_LABEL = {
  commenced_law: { label: "Commenced law", color: "#1f5a34" },
  adopted_policy: { label: "Adopted policy", color: "#2c6a34" },
  formal_guidance: { label: "Formal guidance", color: "#1d7d8c" },
  draft_material: { label: "Draft material", color: "#c98a1e" },
  consultation: { label: "Consultation", color: "#c98a1e" },
  emerging_practice: { label: "Emerging practice", color: "#8a927c" },
};

function formatWeek(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : `Week of ${date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
}

function DevelopmentCard({ development }) {
  const status = STATUS_LABEL[development.legal_status] || { label: development.legal_status || "Unknown", color: "#8a927c" };
  return (
    <div className="mb-development">
      <div className="mb-development-head">
        <span className="mb-development-badge" style={{ background: `${status.color}1a`, color: status.color, borderColor: `${status.color}55` }}>{status.label}</span>
        <span className="mb-development-cat">{development.category}</span>
        <span className="mb-development-juris">{development.jurisdiction}</span>
      </div>
      <h4>{development.title}</h4>
      {development.what_changed ? <p>{development.what_changed}</p> : null}
      <div className="mb-development-dates">
        {development.published_date ? <span>Published {development.published_date}</span> : null}
        {development.effective_date ? <span>Effective {development.effective_date}</span> : null}
      </div>
      {development.practical_consequences ? (
        <div className="mb-development-block">
          <strong>Practical consequences</strong>
          <p>{development.practical_consequences}</p>
        </div>
      ) : null}
      {development.recommended_action ? (
        <div className="mb-development-block action">
          <strong><CheckCircle2 size={13} /> Recommended action</strong>
          <p>{development.recommended_action}</p>
        </div>
      ) : null}
      {Array.isArray(development.sources) && development.sources.length ? (
        <div className="mb-development-sources">
          {development.sources.map((source, index) => (
            <a key={index} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> {source.title || "Source"}</a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function MondayBrief({ compact = false }) {
  const { session } = useAuth();
  const [brief, setBrief] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token || ""}` }), [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/monday-brief", { headers: headers() })
      .then((response) => response.json())
      .then((data) => setBrief(data.brief || null))
      .catch(() => setError("Could not load this week's brief."))
      .finally(() => setLoading(false));
  }, [session?.access_token, headers]);

  const loadHistory = () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    if (history.length) return;
    fetch("/api/monday-brief?history=true", { headers: headers() })
      .then((response) => response.json())
      .then((data) => setHistory(data.briefs || []));
  };

  if (loading) return <div className="mb-loading"><Loader2 size={16} className="spin" /> Loading Monday Brief…</div>;
  if (error) return <p className="mb-error"><AlertCircle size={14} /> {error}</p>;

  if (!brief || brief.status !== "ready") {
    return (
      <div className="mb-empty">
        <Newspaper size={20} />
        <strong>{brief?.status === "generating" ? "This week's brief is being researched" : "No brief yet"}</strong>
        <span>{brief?.status === "generating" ? "Check back shortly — it's compiled every Monday morning." : "The first Monday Brief will appear here once generated."}</span>
      </div>
    );
  }

  return (
    <div className={`mb${compact ? " mb-compact" : ""}`}>
      <style>{`
        .mb-development { border: 1px solid #e3ded2; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
        .mb-development-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .mb-development-badge { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 3px 8px; border-radius: 5px; border: 1px solid; }
        .mb-development-cat, .mb-development-juris { font-size: 11px; color: #6b755f; }
        .mb-development h4 { margin: 0 0 6px; font-size: 14.5px; color: #12211a; }
        .mb-development p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.5; color: #3a4740; }
        .mb-development-dates { display: flex; gap: 12px; font-size: 11px; color: #8a927c; margin-bottom: 8px; }
        .mb-development-block { background: #f7f8f2; border-radius: 7px; padding: 8px 10px; margin-bottom: 6px; }
        .mb-development-block.action { background: #eef6ea; }
        .mb-development-block strong { display: flex; align-items: center; gap: 5px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #2c6a34; margin-bottom: 3px; }
        .mb-development-sources { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
        .mb-development-sources a { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #1d7d8c; text-decoration: none; }
        .mb-loading, .mb-error { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b755f; padding: 16px; }
        .mb-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; padding: 30px 20px; color: #6b755f; }
      `}</style>
      <div className="mb-header">
        <span><BookOpen size={13} /> {formatWeek(brief.week_of)}</span>
      </div>
      {brief.summary ? <p className="mb-summary">{brief.summary}</p> : null}

      {(brief.developments || []).length ? (
        <section>
          <h3>This week's developments</h3>
          {brief.developments.map((development, index) => <DevelopmentCard key={index} development={development} />)}
        </section>
      ) : null}

      {(brief.actions_this_week || []).length ? (
        <section className="mb-actions">
          <h3><CheckCircle2 size={15} /> Actions for this week</h3>
          <ul>{brief.actions_this_week.map((action, index) => <li key={index}>{action}</li>)}</ul>
        </section>
      ) : null}

      {(brief.watchlist || []).length ? (
        <section>
          <h3><Eye size={15} /> Watchlist</h3>
          {brief.watchlist.map((item, index) => (
            <div key={index} className="mb-watch-item">
              <strong>{item.title}</strong>
              <p>{item.why_it_matters}</p>
              {item.expected_timing ? <small><CalendarClock size={11} /> {item.expected_timing}</small> : null}
            </div>
          ))}
        </section>
      ) : null}

      {(brief.no_material_change_categories || []).length ? (
        <p className="mb-no-change">No material change this week: {brief.no_material_change_categories.join(", ")}.</p>
      ) : null}

      <button type="button" className="mb-history-toggle" onClick={loadHistory}>
        {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Previous briefings
      </button>
      {showHistory ? (
        <div className="mb-history">
          {history.filter((item) => item.id !== brief.id).map((item) => (
            <div key={item.id} className="mb-history-item">
              <strong>{formatWeek(item.week_of)}</strong>
              <p>{item.summary}</p>
            </div>
          ))}
          {history.length <= 1 ? <p className="mb-empty-inline">No earlier briefings yet.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
