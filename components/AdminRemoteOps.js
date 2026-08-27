"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe, Clock, MessageSquare, FileText, AlertCircle, CheckCircle2, Send } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import RemoteTasks from "./RemoteTasks";

async function api(session, type, method = "GET", body, id) {
  const url = `/api/remote-ops?type=${type}${id ? `&id=${id}` : ""}`;
  const res = await fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function Stat({ label, value }) {
  return <div className="ro-stat"><div className="ro-stat-value">{value}</div><div className="ro-stat-label">{label}</div></div>;
}

export default function AdminRemoteOps() {
  const { session } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [clientRecords, setClientRecords] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState({}); // { [id]: responseText }

  const reload = useCallback(async () => {
    try {
      const [p, c, q, i] = await Promise.all([
        api(session, "profiles"), api(session, "client-records"), api(session, "quotes"), api(session, "issues"),
      ]);
      setProfiles(p.records); setClientRecords(c.records); setQuotes(q.records); setIssues(i.records);
    } catch (e) { setError(e.message); }
  }, [session]);

  useEffect(() => { if (session?.access_token) reload(); }, [session, reload]);

  const notify = (m) => { setMessage(m); setError(""); setTimeout(() => setMessage(""), 2500); };

  const respond = async (type, id, fields) => {
    try { await api(session, type, "PATCH", fields, id); await reload(); notify("Updated."); }
    catch (e) { setError(e.message); }
  };

  const openClient = clientRecords.filter((c) => c.status !== "closed");
  const openIssues = issues.filter((i) => i.status !== "resolved");

  return (
    <div className="ro-page" style={{ padding: 0 }}>
      <header className="ro-hero">
        <span><Globe size={17} /> International delivery oversight</span>
        <h1>Remote operations — oversight</h1>
        <p>Read-only rollup of everyone's remote-work records. Respond to client questions and issues, note quotes and profiles, and close items off for management follow-up.</p>
      </header>

      <div className="ro-stats">
        <Stat label="Active profiles" value={profiles.filter((p) => p.status === "active").length} />
        <Stat label="Open communications" value={openClient.length + openIssues.length} />
        <Stat label="Recent handovers" value={issues.filter((i) => i.issue_type === "handover").length} />
        <Stat label="Active quotes" value={quotes.filter((q) => q.quote_stage === "draft" || q.quote_stage === "sent").length} />
      </div>

      {error ? <p className="ro-error"><AlertCircle size={15} /> {error}</p> : null}
      {message ? <p className="ro-success"><CheckCircle2 size={15} /> {message}</p> : null}

      {/* Task Briefs — assign work to staff (sub-component of Remote Operations) */}
      <RemoteTasks isAdmin={true} />

      {/* Profiles */}
      <section className="ro-followup">
        <div className="ro-card-head"><span className="ro-eyebrow"><Clock size={13} /> Time-zone context</span><h2>Approved remote-work profiles</h2></div>
        {profiles.length ? <div className="ro-list">{profiles.map((p) => (
          <div key={p.id} className="ro-item">
            <div><strong>{p.staff_name || "Profile"}</strong><span className="ro-muted"> · {[p.base_location, p.time_zone].filter(Boolean).join(" · ") || "no location"} · {p.status}</span></div>
            {p.overlap_hours ? <span className="ro-muted">Overlap: {p.overlap_hours}</span> : null}
            <div className="ro-admin-action">
              <input placeholder="Admin note" defaultValue={p.admin_note || ""} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })} />
              <button onClick={() => respond("profiles", p.id, { adminNote: drafts[p.id] ?? p.admin_note ?? "" })}>Save note</button>
            </div>
          </div>
        ))}</div> : <p className="ro-empty">No remote-work profiles submitted yet.</p>}
      </section>

      {/* Client records */}
      <section className="ro-followup">
        <div className="ro-card-head"><span className="ro-eyebrow"><MessageSquare size={13} /> Client coordination</span><h2>Meetings & client questions</h2></div>
        {clientRecords.length ? <div className="ro-list">{clientRecords.map((c) => (
          <div key={c.id} className="ro-item">
            <div><strong>{c.title}</strong><span className="ro-muted"> · {c.kind} · {c.status}</span></div>
            {c.record_detail ? <span>{c.record_detail}</span> : null}
            <div className="ro-admin-action">
              <input placeholder="Response / follow-up" defaultValue={c.admin_response || ""} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} />
              <select defaultValue={c.status} onChange={(e) => setDrafts({ ...drafts, [`${c.id}_s`]: e.target.value })}>
                <option value="open">Open</option><option value="actioned">Actioned</option><option value="closed">Closed</option>
              </select>
              <button onClick={() => respond("client-records", c.id, { adminResponse: drafts[c.id] ?? c.admin_response ?? "", status: drafts[`${c.id}_s`] ?? c.status })}><Send size={12} /> Save</button>
            </div>
          </div>
        ))}</div> : <p className="ro-empty">No client records yet.</p>}
      </section>

      {/* Quotes */}
      <section className="ro-followup">
        <div className="ro-card-head"><span className="ro-eyebrow"><FileText size={13} /> Commercial pipeline</span><h2>Project quotes</h2></div>
        {quotes.length ? <div className="ro-list">{quotes.map((q) => (
          <div key={q.id} className="ro-item">
            <div><strong>{q.quote_reference || "Quote"}</strong><span className="ro-muted"> · {q.quote_stage}{q.quote_value_aud != null ? ` · $${Number(q.quote_value_aud).toLocaleString("en-AU")}` : ""}</span></div>
            {q.commercial_notes ? <span>{q.commercial_notes}</span> : null}
            <div className="ro-admin-action">
              <select defaultValue={q.quote_stage} onChange={(e) => setDrafts({ ...drafts, [`${q.id}_st`]: e.target.value })}>
                <option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="declined">Declined</option>
              </select>
              <input placeholder="Admin note" defaultValue={q.admin_note || ""} onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })} />
              <button onClick={() => respond("quotes", q.id, { quoteStage: drafts[`${q.id}_st`] ?? q.quote_stage, adminNote: drafts[q.id] ?? q.admin_note ?? "" })}>Save</button>
            </div>
          </div>
        ))}</div> : <p className="ro-empty">No quotes yet.</p>}
      </section>

      {/* Issues */}
      <section className="ro-followup">
        <div className="ro-card-head"><span className="ro-eyebrow"><MessageSquare size={13} /> Management follow-up</span><h2>Open questions, issues & client records</h2></div>
        {issues.length ? <div className="ro-list">{issues.map((i) => (
          <div key={i.id} className="ro-item">
            <div><strong>{i.title}</strong><span className="ro-muted"> · {i.issue_type} · {i.status.replace("_", " ")}</span></div>
            {i.detail ? <span>{i.detail}</span> : null}
            <div className="ro-admin-action">
              <input placeholder="Response" defaultValue={i.admin_response || ""} onChange={(e) => setDrafts({ ...drafts, [i.id]: e.target.value })} />
              <select defaultValue={i.status} onChange={(e) => setDrafts({ ...drafts, [`${i.id}_s`]: e.target.value })}>
                <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option>
              </select>
              <button onClick={() => respond("issues", i.id, { adminResponse: drafts[i.id] ?? i.admin_response ?? "", status: drafts[`${i.id}_s`] ?? i.status })}><Send size={12} /> Save</button>
            </div>
          </div>
        ))}</div> : <p className="ro-empty">No open remote-operations records.</p>}
      </section>
    </div>
  );
}
