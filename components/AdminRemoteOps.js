"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe, Clock, MessageSquare, AlertCircle, CheckCircle2, Send } from "lucide-react";
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
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState({}); // { [id]: responseText }

  const reload = useCallback(async () => {
    try {
      // "quotes" is no longer fetched: that register was retired in favour of
      // the Quote Pipeline domain, and requesting it on every load was a
      // round trip whose result nothing rendered.
      const [p, c, i] = await Promise.all([
        api(session, "profiles"), api(session, "client-records"), api(session, "issues"),
      ]);
      setProfiles(p.records); setClientRecords(c.records); setIssues(i.records);
    } catch (e) { setError(e.message); }
  }, [session?.access_token]);

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
        <span><Globe size={17} /> Task briefs &amp; remote coordination</span>
        <h1>Task briefs &amp; remote coordination</h1>
        <p>
          Assign and track task briefs, and see the remote-work context behind them —
          time zones, availability and client coordination. New remote or delivery
          issues are raised by staff through Service Requests (&ldquo;Remote / delivery
          issue&rdquo;); the history below is retained for follow-up. Commercial quotes
          are managed in the Quote Pipeline domain.
        </p>
      </header>

      <div className="ro-stats">
        <Stat label="Active profiles" value={profiles.filter((p) => p.status === "active").length} />
        <Stat label="Open communications" value={openClient.length + openIssues.length} />
        <Stat label="Recent handovers" value={issues.filter((i) => i.issue_type === "handover").length} />
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

      {/* Quotes section removed. remote_quotes was a second commercial register
          running in parallel with the dedicated Quote Pipeline domain
          (quote_pipeline), so the same quote could be tracked in two places with
          different stages and no reconciliation between them. Quote Pipeline is
          the system of record; it has deliverables, margin snapshots, drafts and
          an approval workflow that this section never had. No data deleted —
          remote_quotes is intact and still reachable via /api/remote-ops. */}

      {/* Issues */}
      <section className="ro-followup">
        <div className="ro-card-head"><span className="ro-eyebrow"><MessageSquare size={13} /> Management follow-up</span><h2>Open questions, issues &amp; client records</h2><p className="ro-muted">Historical items. New issues arrive as Service Requests.</p></div>
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
