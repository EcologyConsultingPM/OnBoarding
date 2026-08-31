"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TrendingUp, Plus, Trash2, ExternalLink, AlertCircle, CheckCircle2, Link2, ListFilter, FilePlus2, Sparkles } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import QuoteDraftWorkspace from "./QuoteDraftWorkspace";
import QuotePipelineImprovements from "./QuotePipelineImprovements";

function money(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
}

const STATUS = [
  { value: "pending", label: "Pending", color: "#b08948" },
  { value: "successful", label: "Successful", color: "#2c6a34" },
  { value: "unsuccessful", label: "Unsuccessful", color: "#c0392b" },
  { value: "withdrawn", label: "Withdrawn", color: "#607078" },
];
const SUPERSEDED_FILTER = { value: "superseded", label: "Superseded", color: "#7a6b8d" };
const EMPTY = { client: "", project: "", projectFolderLink: "", quoteLink: "", hyperlink: "", quoteTotal: "", initialSent: false, sentOn: "", followUpOn: "", status: "pending", comments: "", fullyInvoiced: false, superseded: false, supersededNote: "" };
const VIEWS = new Set(["pipeline", "drafts", "improvements"]);

export default function AdminQuotePipeline() {
  const { session } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [summary, setSummary] = useState(null);
  const [financialsVisible, setFinancialsVisible] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY);
  const [filters, setFilters] = useState({ client: "", status: "", sentFrom: "", sentTo: "", sort: "updated_desc" });
  const [view, setView] = useState("drafts");

  const auth = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/quote-pipeline");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQuotes(Array.isArray(data.quotes) ? data.quotes : []);
      setSummary(data.summary || null);
      setFinancialsVisible(data.financialsVisible === true);
    } catch (e) { setError(e.message); }
  }, [auth]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);
  useEffect(() => {
    try {
      const initial = new URLSearchParams(window.location.search).get("quoteView");
      if (VIEWS.has(initial)) setView(initial);
    } catch {}
  }, []);

  const selectView = (next) => {
    setView(next);
    try {
      const url = new URL(window.location.href);
      if (next === "drafts") url.searchParams.delete("quoteView");
      else url.searchParams.set("quoteView", next);
      window.history.replaceState({}, "", url);
    } catch {}
  };
  const notify = (m) => { setMessage(m); setError(""); setTimeout(() => setMessage(""), 2200); };

  const create = async () => {
    if (!form.client.trim() && !form.project.trim()) { setError("Add a client or project."); return; }
    try { const res = await auth("POST", "/api/quote-pipeline", form); const d = await res.json(); if (!res.ok) throw new Error(d.error); setForm(EMPTY); setAdding(false); await load(); notify("Quote added."); } catch (e) { setError(e.message); }
  };
  const saveEdit = async () => {
    try { const res = await auth("PATCH", `/api/quote-pipeline/${editingId}`, editForm); const d = await res.json(); if (!res.ok) throw new Error(d.error); setEditingId(null); await load(); notify("Quote updated."); } catch (e) { setError(e.message); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this quote from the pipeline?")) return;
    try { const res = await auth("DELETE", `/api/quote-pipeline/${id}`); const d = await res.json(); if (!res.ok) throw new Error(d.error); await load(); } catch (e) { setError(e.message); }
  };
  const startEdit = (q) => {
    setEditingId(q.id);
    setEditForm({ client: q.client || "", project: q.project || "", projectFolderLink: q.project_folder_link || "", quoteLink: q.quote_link || "", hyperlink: q.hyperlink || "", quoteTotal: q.quote_total ?? "", initialSent: q.initial_sent, sentOn: q.sent_on || "", followUpOn: q.follow_up_on || "", status: q.status, comments: q.comments || "", fullyInvoiced: q.fully_invoiced, superseded: q.superseded, supersededNote: q.superseded_note || "" });
  };

  const clients = useMemo(() => [...new Set(quotes.map((quote) => quote.client).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [quotes]);
  const visibleQuotes = useMemo(() => {
    const filtered = quotes.filter((quote) => {
      if (filters.client && quote.client !== filters.client) return false;
      if (filters.status === "superseded" && !quote.superseded) return false;
      if (filters.status && filters.status !== "superseded" && quote.status !== filters.status) return false;
      if (filters.sentFrom && (!quote.sent_on || quote.sent_on < filters.sentFrom)) return false;
      if (filters.sentTo && (!quote.sent_on || quote.sent_on > filters.sentTo)) return false;
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (filters.sort === "client") return String(left.client || "").localeCompare(String(right.client || ""));
      if (filters.sort === "sent_desc") return String(right.sent_on || "").localeCompare(String(left.sent_on || ""));
      if (filters.sort === "sent_asc") return String(left.sent_on || "").localeCompare(String(right.sent_on || ""));
      if (filters.sort === "value_desc") return Number(right.quote_total || 0) - Number(left.quote_total || 0);
      if (filters.sort === "follow_up") return String(left.follow_up_on || "9999-12-31").localeCompare(String(right.follow_up_on || "9999-12-31"));
      return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
    });
  }, [quotes, filters]);

  const EditRow = ({ f, set, canSeeFinancials }) => {
    const isSuperseded = f.superseded === true;
    return <>
      <input placeholder="Client" value={f.client} onChange={(e) => set({ ...f, client: e.target.value })} />
      <input placeholder="Project" value={f.project} onChange={(e) => set({ ...f, project: e.target.value })} />
      {canSeeFinancials ? <input placeholder="Quote total" value={f.quoteTotal} onChange={(e) => set({ ...f, quoteTotal: e.target.value })} /> : null}
      <input placeholder="Project folder link (URL)" value={f.projectFolderLink} onChange={(e) => set({ ...f, projectFolderLink: e.target.value })} />
      <input placeholder="Quote link (URL)" value={f.quoteLink} onChange={(e) => set({ ...f, quoteLink: e.target.value })} />
      <input placeholder="Hyperlink (URL)" value={f.hyperlink} onChange={(e) => set({ ...f, hyperlink: e.target.value })} />
      <label className="qp-check"><input type="checkbox" checked={f.initialSent} onChange={(e) => set({ ...f, initialSent: e.target.checked })} /> Sent</label>
      <input type="date" value={f.sentOn} onChange={(e) => set({ ...f, sentOn: e.target.value })} title="Sent on (follow-up auto-sets to +7 days)" />
      <input type="date" value={f.followUpOn} onChange={(e) => set({ ...f, followUpOn: e.target.value })} title="Follow-up" />
      <select value={f.status} onChange={(e) => set({ ...f, status: e.target.value })}>{STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
      <input placeholder="Comments" value={f.comments} onChange={(e) => set({ ...f, comments: e.target.value })} />
      <label className="qp-check"><input type="checkbox" checked={f.fullyInvoiced} onChange={(e) => set({ ...f, fullyInvoiced: e.target.checked })} /> Invoiced</label>
      <label className="qp-check qp-super"><input type="checkbox" checked={isSuperseded} onChange={(e) => set({ ...f, superseded: e.target.checked })} /> Superseded</label>
      {isSuperseded ? <input placeholder="Superseded by / note" value={f.supersededNote} onChange={(e) => set({ ...f, supersededNote: e.target.value })} /> : null}
    </>;
  };

  return <div className="qp">
    <nav className="qp-subnav" aria-label="Quote Pipeline sub-domains">
      <button type="button" className={view === "drafts" ? "active" : ""} onClick={() => selectView("drafts")}><FilePlus2 size={16} /> Quotes to be Drafted</button>
      <button type="button" className={view === "pipeline" ? "active" : ""} onClick={() => selectView("pipeline")}><TrendingUp size={16} /> Issued Quote Pipeline</button>
      <button type="button" className={view === "improvements" ? "active" : ""} onClick={() => selectView("improvements")}><Sparkles size={16} /> Improvements</button>
    </nav>

    {view === "drafts" ? <QuoteDraftWorkspace onPipelineChanged={load} /> : null}
    {view === "improvements" ? <QuotePipelineImprovements quotes={quotes} summary={summary} onOpenDrafts={() => selectView("drafts")} /> : null}
    {view === "pipeline" ? <>
      <header className="qp-hero"><span><TrendingUp size={17} /> Delivery & commercial · Admin</span><h1>Issued Quote Pipeline</h1><p>Track issued quotes, outcomes and client follow-up. Dollar values and financial totals are shown only to people with authorised commercial visibility. Mark a quote superseded when a newer quote replaces it.</p></header>
      {summary ? <div className="qp-summary"><div className="qp-sum"><div className="qp-sum-v">{summary.sent}</div><div className="qp-sum-l">Quotes sent</div></div><div className="qp-sum"><div className="qp-sum-v" style={{ color: "#2c6a34" }}>{summary.successful}</div><div className="qp-sum-l">Successful</div></div><div className="qp-sum"><div className="qp-sum-v">{summary.successRate}%</div><div className="qp-sum-l">Success rate</div></div>{financialsVisible ? <><div className="qp-sum"><div className="qp-sum-v">{money(summary.estimatedPipeline)}</div><div className="qp-sum-l">Estimated pipeline</div></div><div className="qp-sum"><div className="qp-sum-v">{money(summary.successfulValue)}</div><div className="qp-sum-l">Successful value</div></div></> : <div className="qp-financials-locked">Financial values are restricted by portal access controls.</div>}</div> : null}
      {error ? <p className="qp-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="qp-success"><CheckCircle2 size={15} /> {message}</p> : null}
      <section className="qp-controls" aria-label="Quote Pipeline controls"><div className="qp-controls-title"><ListFilter size={15} /><span>Find and arrange issued quotes</span><b>{visibleQuotes.length} of {quotes.length}</b></div><div className="qp-controls-fields"><label>Client<select value={filters.client} onChange={(event) => setFilters({ ...filters, client: event.target.value })}><option value="">All clients</option>{clients.map((client) => <option key={client} value={client}>{client}</option>)}</select></label><label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{[...STATUS, SUPERSEDED_FILTER].map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label>Sent from<input type="date" value={filters.sentFrom} onChange={(event) => setFilters({ ...filters, sentFrom: event.target.value })} /></label><label>Sent to<input type="date" value={filters.sentTo} onChange={(event) => setFilters({ ...filters, sentTo: event.target.value })} /></label><label>Sort by<select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}><option value="updated_desc">Recently updated</option><option value="sent_desc">Sent date · newest</option><option value="sent_asc">Sent date · oldest</option><option value="client">Client · A–Z</option>{financialsVisible ? <option value="value_desc">Quote value · highest</option> : null}<option value="follow_up">Next follow-up</option></select></label><button type="button" className="qp-clear-controls" onClick={() => setFilters({ client: "", status: "", sentFrom: "", sentTo: "", sort: "updated_desc" })}>Clear</button></div></section>
      {adding ? <div className="qp-editor"><div className="qp-editor-grid"><EditRow f={form} set={setForm} canSeeFinancials={financialsVisible} /></div><div className="qp-editor-actions"><button className="qp-primary" onClick={create}>Save quote</button><button className="qp-secondary" onClick={() => { setAdding(false); setForm(EMPTY); }}>Cancel</button></div></div> : <button className="qp-add" onClick={() => setAdding(true)}><Plus size={14} /> Add issued quote</button>}
      <div className="qp-table-wrap"><table className="qp-table"><thead><tr><th>Client</th><th>Project</th>{financialsVisible ? <th>Total</th> : null}<th>Links</th><th>Sent</th><th>Follow-up</th><th>Status</th><th>Comments</th><th></th></tr></thead><tbody>{visibleQuotes.map((q) => editingId === q.id ? <tr key={q.id} className="qp-editing"><td colSpan={financialsVisible ? 9 : 8}><div className="qp-editor-grid"><EditRow f={editForm} set={setEditForm} canSeeFinancials={financialsVisible} /></div><div className="qp-editor-actions"><button className="qp-primary" onClick={saveEdit}>Save</button><button className="qp-secondary" onClick={() => setEditingId(null)}>Cancel</button></div></td></tr> : <tr key={q.id} className={q.superseded ? "qp-superseded" : ""}><td>{q.client || "—"}</td><td>{q.project || "—"}{q.superseded ? <span className="qp-super-tag" title={q.superseded_note || "Superseded"}>superseded</span> : null}</td>{financialsVisible ? <td>{money(q.quote_total)}</td> : null}<td className="qp-links">{q.quote_link ? <a href={q.quote_link} target="_blank" rel="noreferrer" title="Quote link"><ExternalLink size={13} /></a> : null}{q.hyperlink ? <a href={q.hyperlink} target="_blank" rel="noreferrer" title="Hyperlink"><Link2 size={13} /></a> : null}{!q.quote_link && !q.hyperlink ? "—" : null}</td><td>{q.initial_sent ? (q.sent_on || "✓") : "—"}</td><td>{q.follow_up_on || "—"}</td><td><span className="qp-status" style={{ background: `${(q.superseded ? SUPERSEDED_FILTER : STATUS.find((s) => s.value === q.status))?.color}1a`, color: (q.superseded ? SUPERSEDED_FILTER : STATUS.find((s) => s.value === q.status))?.color }}>{(q.superseded ? SUPERSEDED_FILTER : STATUS.find((s) => s.value === q.status))?.label || "Pending"}</span></td><td className="qp-comments">{q.comments || "—"}</td><td className="qp-actions"><button onClick={() => startEdit(q)} className="qp-edit">Edit</button><button onClick={() => remove(q.id)} className="qp-del"><Trash2 size={13} /></button></td></tr>)}</tbody></table>{!quotes.length ? <p className="qp-empty">No issued quotes yet. Start new enquiries under Quotes to be Drafted.</p> : null}{quotes.length > 0 && !visibleQuotes.length ? <p className="qp-empty">No issued quotes match the current filters.</p> : null}</div>
    </> : null}
  </div>;
}
