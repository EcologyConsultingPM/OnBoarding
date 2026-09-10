"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, BookOpenCheck, ExternalLink, FileSearch, ListFilter, Plus, RefreshCw, Scale, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS = {
  new: { label: "New review", tone: "review" },
  reviewing: { label: "Reviewing", tone: "review" },
  assessed: { label: "Assessed", tone: "information" },
  actioned: { label: "Actioned", tone: "action" },
  not_applicable: { label: "Not applicable", tone: "neutral" },
};
const SEVERITY = {
  critical: "Critical", action: "Action required", review: "Review required", information: "Information",
};
const CATEGORY = {
  whs: "WHS legislation", biodiversity: "BAM and biodiversity", flora_fauna: "Flora and fauna surveys", environmental_reform: "Environmental reform",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
function sourceOf(update) {
  if (!update || typeof update !== "object") return null;
  const value = update.regulatory_sources;
  const source = Array.isArray(value) ? value.find((item) => item && typeof item === "object") : value;
  return source && typeof source === "object" ? source : null;
}
function safeRecords(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

// Regulatory Watch deliberately displays only to administrators. Automated
// source changes are unreviewed compliance prompts, never legal advice or an
// automatic change to forms, survey standards or controlled documents.
export default function AdminRegulatoryWatch({ onToast }) {
  const { session } = useAuth();
  const [sources, setSources] = useState([]);
  const [legisWatchlist, setLegisWatchlist] = useState([]);
  const [legisWeek, setLegisWeek] = useState(null);
  const [legisLoading, setLegisLoading] = useState(true);
  const [updates, setUpdates] = useState([]);
  const [healthAlerts, setHealthAlerts] = useState([]);
  const [filters, setFilters] = useState({ view: "open", category: "", severity: "", source: "", search: "", sort: "detected_desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [drafts, setDrafts] = useState({});
  const [creating, setCreating] = useState(false);
  const [newUpdate, setNewUpdate] = useState({ title: "", summary: "", source_url: "", source_id: "", severity: "review", review_due_date: "", affected_domains: [] });

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/regulatory-watch", { headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not load Regulatory Watch.");
      // Historical watch records can legitimately have no retained source link.
      // Keep those review items visible rather than allowing an unexpected
      // relationship payload to fail the entire client workspace.
      setSources(safeRecords(body?.sources));
      setUpdates(safeRecords(body?.updates));
      setHealthAlerts(safeRecords(body?.healthAlerts));
    } catch (err) {
      setError(err.message || "Could not load Regulatory Watch.");
    } finally {
      setLoading(false);
    }
  }, [headers, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/legis", { headers: headers() })
      .then((response) => response.json())
      .then((data) => {
        if (data.brief?.status === "ready") {
          setLegisWatchlist(data.brief.watchlist || []);
          setLegisWeek(data.brief.week_of || null);
        }
      })
      .catch(() => {})
      .finally(() => setLegisLoading(false));
  }, [session?.access_token, headers]);

  const visibleUpdates = useMemo(() => {
    const filtered = safeRecords(updates).filter((update) => {
      const source = sourceOf(update);
      if (filters.view === "open" && !["new", "reviewing"].includes(update.status)) return false;
      if (filters.view !== "open" && filters.view !== "all" && update.status !== filters.view) return false;
      if (filters.category && source?.category !== filters.category) return false;
      if (filters.severity && update.severity !== filters.severity) return false;
      if (filters.source && update.source_id !== filters.source) return false;
      if (filters.search) {
        const value = `${update.title || ""} ${update.summary || ""} ${source?.title || ""}`.toLowerCase();
        if (!value.includes(filters.search.toLowerCase())) return false;
      }
      return true;
    });
    const severityRank = { critical: 4, action: 3, review: 2, information: 1 };
    return [...filtered].sort((left, right) => {
      if (filters.sort === "due_asc") return String(left.review_due_date || "9999-12-31").localeCompare(String(right.review_due_date || "9999-12-31"));
      if (filters.sort === "severity") return (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0);
      if (filters.sort === "title") return String(left.title || "").localeCompare(String(right.title || ""));
      return String(right.detected_at || "").localeCompare(String(left.detected_at || ""));
    });
  }, [filters, updates]);
  const openCount = safeRecords(updates).filter((update) => ["new", "reviewing"].includes(update.status)).length;
  const dueCount = safeRecords(updates).filter((update) => update.review_due_date && ["new", "reviewing"].includes(update.status) && new Date(`${update.review_due_date}T23:59:59`) < new Date()).length;

  const review = async (update, notifyStaff = false) => {
    const draft = drafts[update.id] || {};
    setError("");
    try {
      const response = await fetch("/api/regulatory-watch", {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          id: update.id,
          action: "review",
          status: draft.status || update.status,
          severity: draft.severity || update.severity,
          review_note: draft.review_note ?? update.review_note ?? "",
          review_due_date: draft.review_due_date ?? update.review_due_date ?? null,
          notify_staff: notifyStaff,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save review.");
      setUpdates((current) => current.map((item) => item.id === update.id ? body.update : item));
      setOpenId("");
      setDrafts((current) => { const next = { ...current }; delete next[update.id]; return next; });
      onToast?.(notifyStaff ? "Assessed update published to staff noticeboard." : "Regulatory review saved.");
    } catch (err) {
      setError(err.message || "Could not save review.");
    }
  };

  const removeUpdate = async (update) => {
    if (!window.confirm(`Delete the Regulatory Watch item “${update.title}”? This also removes linked in-portal alerts, but does not remove the official source.`)) return;
    setError("");
    try {
      const response = await fetch(`/api/regulatory-watch?id=${encodeURIComponent(update.id)}`, { method: "DELETE", headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not delete the Regulatory Watch item.");
      setUpdates((current) => current.filter((item) => item.id !== update.id));
      onToast?.("Regulatory Watch item deleted.");
    } catch (err) {
      setError(err.message || "Could not delete the Regulatory Watch item.");
    }
  };

  const createManual = async () => {
    const title = newUpdate.title.trim();
    const summary = newUpdate.summary.trim();
    const sourceUrl = newUpdate.source_url.trim() || sources.find((source) => source.id === newUpdate.source_id)?.source_url || "";
    if (!title || !summary || !sourceUrl) {
      setError("Provide a title, review summary and official source URL.");
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/regulatory-watch", {
        method: "POST", headers: headers(),
        body: JSON.stringify({ ...newUpdate, action: "add_manual_update", title, summary, source_url: sourceUrl }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not add the regulatory update.");
      setUpdates((current) => [body.update, ...current]);
      setNewUpdate({ title: "", summary: "", source_url: "", source_id: "", severity: "review", review_due_date: "", affected_domains: [] });
      setCreating(false);
      onToast?.("Regulatory Watch item added for review.");
    } catch (err) {
      setError(err.message || "Could not add the regulatory update.");
    }
  };

  return (
    <section className="reg-watch" aria-label="Regulatory Watch">
      <style>{`
        .reg-watch__legis { background: #F1F2F4; border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
        .reg-watch__legis-head span { display: inline-flex; align-items: center; gap: 5px; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #001F54; }
        .reg-watch__legis-head h3 { margin: 4px 0 4px; color: #001F54; font-size: 16px; }
        .reg-watch__legis-head p { margin: 0 0 10px; font-size: 12.5px; color: #374151; line-height: 1.5; }
        .reg-watch__legis-table-wrap { overflow-x: auto; }
        .reg-watch__legis-table { width: 100%; border-collapse: collapse; font-size: 12.5px; background: #fff; border-radius: 8px; overflow: hidden; }
        .reg-watch__legis-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #6b7280; padding: 7px 10px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
        .reg-watch__legis-table td { padding: 8px 10px; border-bottom: 1px solid #f1f2f4; color: #0F172A; vertical-align: top; }
        .reg-watch__legis-table td small { display: block; color: #92400e; font-style: italic; margin-top: 2px; }
        .reg-watch__likelihood { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
        .reg-watch__likelihood--high { background: #fde2e1; color: #a5342a; }
        .reg-watch__likelihood--medium { background: #fdecc8; color: #92400e; }
        .reg-watch__likelihood--low { background: #e5e7eb; color: #4b5563; }
      `}</style>
      <header className="reg-watch__hero">
        <div>
          <span><ShieldAlert size={14} /> Official regulatory intelligence</span>
          <h2>Regulatory Watch</h2>
          <p>Review official changes to WHS law, BAM guidance, threatened flora and fauna survey requirements, and environmental reforms before changing Ecology Consulting practice or notifying staff.</p>
        </div>
        <div className="reg-watch__hero-actions">
          <button type="button" onClick={load} className="reg-watch__outline" disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh</button>
          <button type="button" onClick={() => setCreating((value) => !value)} className="reg-watch__primary"><Plus size={14} /> Add update</button>
        </div>
      </header>

      <section className="reg-watch__legis" aria-label="Legis regulatory watchlist">
        <div className="reg-watch__legis-head">
          <span><Scale size={14} /> Legis</span>
          <h3>Regulatory Watchlist</h3>
          <p>Reforms, consultations, draft legislation and anticipated changes Legis is tracking but has not yet escalated to a review item below. Updated every Monday.{legisWeek ? ` Last updated: week of ${legisWeek}.` : ""}</p>
        </div>
        {legisLoading ? (
          <p className="reg-watch__empty">Loading Legis watchlist…</p>
        ) : legisWatchlist.length ? (
          <div className="reg-watch__legis-table-wrap">
            <table className="reg-watch__legis-table">
              <thead><tr><th>Issue</th><th>Jurisdiction</th><th>Potential impact</th><th>Current status</th><th>Next milestone</th><th>Likelihood</th></tr></thead>
              <tbody>
                {legisWatchlist.map((item, index) => (
                  <tr key={index}>
                    <td><strong>{item.issue}</strong>{item.carried_forward_note ? <small>Since last week: {item.carried_forward_note}</small> : null}</td>
                    <td>{item.jurisdiction || "—"}</td>
                    <td>{item.potential_impact || "—"}</td>
                    <td>{item.current_status ? item.current_status.replaceAll("_", " ") : "—"}</td>
                    <td>{item.next_milestone_date || "—"}</td>
                    <td><span className={`reg-watch__likelihood reg-watch__likelihood--${String(item.likelihood || "").toLowerCase()}`}>{item.likelihood || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="reg-watch__empty">Nothing on the Legis watchlist right now.</p>
        )}
      </section>

      <div className="reg-watch__summary" aria-label="Regulatory Watch summary">
        <div><strong>{openCount}</strong><span>Open reviews</span></div>
        <div><strong className={dueCount ? "is-alert" : ""}>{dueCount}</strong><span>Overdue review</span></div>
        <div><strong>{safeRecords(sources).filter((source) => source.active).length}</strong><span>Official sources</span></div>
        <div><strong>{safeRecords(updates).filter((update) => update.staff_notified_at).length}</strong><span>Staff notices issued</span></div>
      </div>

      {creating ? (
        <section className="reg-watch__create">
          <h3><Plus size={16} /> Record an official update for review</h3>
          <p>This creates an internal review item only. It does not alter any procedure, survey method, form or staff requirement.</p>
          <div className="reg-watch__form-grid">
            <label><span>Official source</span><select value={newUpdate.source_id} onChange={(event) => setNewUpdate({ ...newUpdate, source_id: event.target.value, source_url: "" })}><option value="">Choose source or enter URL below</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
            <label><span>Priority</span><select value={newUpdate.severity} onChange={(event) => setNewUpdate({ ...newUpdate, severity: event.target.value })}>{Object.entries(SEVERITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Review due date</span><input type="date" value={newUpdate.review_due_date} onChange={(event) => setNewUpdate({ ...newUpdate, review_due_date: event.target.value })} /></label>
            <label className="reg-watch__wide"><span>Change title</span><input value={newUpdate.title} onChange={(event) => setNewUpdate({ ...newUpdate, title: event.target.value })} placeholder="e.g. Revised targeted flora survey guidance" /></label>
            <label className="reg-watch__wide"><span>Official source URL</span><input value={newUpdate.source_url} onChange={(event) => setNewUpdate({ ...newUpdate, source_url: event.target.value })} placeholder="https://…" /></label>
            <label className="reg-watch__wide"><span>What changed / review prompt</span><textarea rows={3} value={newUpdate.summary} onChange={(event) => setNewUpdate({ ...newUpdate, summary: event.target.value })} placeholder="Describe the reported change and the review needed. Do not state legal conclusions until reviewed." /></label>
          </div>
          <div className="reg-watch__actions"><button type="button" className="reg-watch__primary" onClick={createManual}>Create review item</button><button type="button" className="reg-watch__text" onClick={() => setCreating(false)}>Cancel</button></div>
        </section>
      ) : null}

      <section className="reg-watch__toolbar" aria-label="Regulatory Watch controls">
        <div className="reg-watch__filters" role="tablist" aria-label="Filter Regulatory Watch updates">
          {[ ["open", `Open (${openCount})`], ["new", "New"], ["reviewing", "Reviewing"], ["actioned", "Actioned"], ["assessed", "Assessed"], ["not_applicable", "Not applicable"], ["all", "All"] ].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filters.view === value} className={filters.view === value ? "selected" : ""} onClick={() => setFilters({ ...filters, view: value })}>{label}</button>)}
        </div>
        <div className="reg-watch__control-fields">
          <label>Search<input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Title, source or summary" /></label>
          <label>Category<select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">All categories</option>{Object.entries(CATEGORY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Priority<select value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}><option value="">All priorities</option>{Object.entries(SEVERITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Official source<select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">All sources</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
          <label>Sort by<select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}><option value="detected_desc">Recently detected</option><option value="due_asc">Review due date</option><option value="severity">Priority · highest first</option><option value="title">Title · A–Z</option></select></label>
          <button type="button" className="reg-watch__clear-controls" onClick={() => setFilters({ view: "open", category: "", severity: "", source: "", search: "", sort: "detected_desc" })}><ListFilter size={13} /> Clear</button>
        </div>
      </section>

      {error ? <div className="reg-watch__error" role="alert"><ShieldAlert size={15} /> {error}</div> : null}
      {loading ? <p className="reg-watch__empty">Loading Regulatory Watch…</p> : null}
      {!loading && !error && visibleUpdates.length === 0 ? <p className="reg-watch__empty">No updates in this view. A scheduled scan will add review items only when a monitored official source changes.</p> : null}
      <div className="reg-watch__list">
        {visibleUpdates.map((update) => {
          const source = sourceOf(update);
          const editing = openId === update.id;
          const draft = drafts[update.id] || {};
          const status = STATUS[update.status] || STATUS.new;
          return (
            <article className={`reg-watch__card severity-${update.severity}`} key={update.id}>
              <div className="reg-watch__card-top">
                <div>
                  <span className={`reg-watch__badge ${status.tone}`}>{status.label}</span>
                  <span className={`reg-watch__badge severity ${update.severity}`}>{SEVERITY[update.severity] || update.severity}</span>
                  {source?.category ? <span className="reg-watch__category">{CATEGORY[source.category] || source.category}</span> : null}
                  <h3>{update.title}</h3>
                  <p>{update.summary}</p>
                </div>
                <div className="reg-watch__meta"><span>Detected {formatDate(update.detected_at)}</span>{update.review_due_date ? <span>Review due {formatDate(update.review_due_date)}</span> : null}</div>
              </div>
              <div className="reg-watch__source"><BookOpenCheck size={14} /><span>{source?.authority_name || "Official source"}{source?.title ? ` · ${source.title}` : ""}</span><a href={update.source_url} target="_blank" rel="noreferrer">Open source <ExternalLink size={12} /></a></div>
              {update.review_note && !editing ? <div className="reg-watch__note"><strong>Review record</strong><p>{update.review_note}</p>{update.reviewed_at ? <small>Reviewed {formatDate(update.reviewed_at)}</small> : null}</div> : null}
              {editing ? (
                <div className="reg-watch__review-form">
                  <div className="reg-watch__form-grid compact">
                    <label><span>Review status</span><select value={draft.status || update.status} onChange={(event) => setDrafts({ ...drafts, [update.id]: { ...draft, status: event.target.value } })}>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
                    <label><span>Priority</span><select value={draft.severity || update.severity} onChange={(event) => setDrafts({ ...drafts, [update.id]: { ...draft, severity: event.target.value } })}>{Object.entries(SEVERITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label><span>Review due date</span><input type="date" value={draft.review_due_date ?? update.review_due_date ?? ""} onChange={(event) => setDrafts({ ...drafts, [update.id]: { ...draft, review_due_date: event.target.value } })} /></label>
                    <label className="reg-watch__wide"><span>Assessment, impact and action</span><textarea rows={4} value={draft.review_note ?? update.review_note ?? ""} onChange={(event) => setDrafts({ ...drafts, [update.id]: { ...draft, review_note: event.target.value } })} placeholder="Record impact, decision, required procedure/training/project action and accountable owner." /></label>
                  </div>
                  <div className="reg-watch__actions"><button type="button" className="reg-watch__primary" onClick={() => review(update)}>Save review</button>{["assessed", "actioned"].includes(draft.status || update.status) && !update.staff_notified_at ? <button type="button" className="reg-watch__notify" onClick={() => review(update, true)}><Send size={13} /> Save & notify staff</button> : null}<button type="button" className="reg-watch__text" onClick={() => { setOpenId(""); setDrafts((current) => { const next = { ...current }; delete next[update.id]; return next; }); }}>Cancel</button></div>
                </div>
              ) : <div className="reg-watch__actions"><button type="button" className="reg-watch__review-button" onClick={() => setOpenId(update.id)}><FileSearch size={14} /> {update.status === "new" ? "Start review" : "Edit review"}</button>{update.staff_notified_at ? <span className="reg-watch__notified"><BellRing size={13} /> Staff notified {formatDate(update.staff_notified_at)}</span> : null}<button type="button" className="reg-watch__delete" onClick={() => removeUpdate(update)}><Trash2 size={13} /> Delete</button></div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
