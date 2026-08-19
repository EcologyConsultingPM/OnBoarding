"use client";

import { useEffect, useState, useCallback } from "react";
import { Megaphone, Plus, Check, X, Clock, Eye, AlertCircle, Send } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS_META = {
  draft: { label: "Draft", color: "#8a927c" },
  submitted: { label: "Awaiting approval", color: "#b08948" },
  approved: { label: "Approved — ready to publish", color: "#4197D0" },
  published: { label: "Published", color: "#2c6a34" },
  declined: { label: "Declined", color: "#c0392b" },
};

export default function Noticeboard({ compact = false }) {
  const { session } = useAuth();
  const [notices, setNotices] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState(null);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", category: "" });

  const auth = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/notices");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load notices.");
      setNotices(data.notices); setIsAdmin(data.isAdmin); setUserId(data.userId);
    } catch (e) { setError(e.message); }
  }, [auth]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  // Mark published notices read once seen.
  useEffect(() => {
    if (!session?.access_token) return;
    notices.filter((n) => n.status === "published" && n.created_by !== userId).forEach((n) => {
      auth("POST", `/api/notices/${n.id}`).catch(() => {});
    });
  }, [notices, session, userId, auth]);

  const act = async (id, action, extra = {}) => {
    try {
      const res = await auth("PATCH", `/api/notices/${id}`, { action, ...extra });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed.");
      await load();
    } catch (e) { setError(e.message); }
  };

  const createNotice = async (submit) => {
    if (!form.title.trim()) { setError("A title is required."); return; }
    try {
      const res = await auth("POST", "/api/notices", { ...form, submit });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create notice.");
      setForm({ title: "", body: "", category: "" }); setComposing(false); await load();
    } catch (e) { setError(e.message); }
  };

  const published = notices.filter((n) => n.status === "published");
  const mine = notices.filter((n) => n.created_by === userId && n.status !== "published");
  const pendingApproval = isAdmin ? notices.filter((n) => n.status === "submitted") : [];

  return (
    <div className="nb">
      {!compact && (
        <header className="nb-hero">
          <span><Megaphone size={17} /> Staff communications</span>
          <h1>Noticeboard</h1>
          <p>Anyone can draft a notice. An administrator approves its release, then the author publishes it to the board.</p>
        </header>
      )}

      {error ? <p className="nb-error" role="alert"><AlertCircle size={15} /> {error}</p> : null}

      {/* Admin approval queue */}
      {pendingApproval.length > 0 && (
        <section className="nb-section nb-queue">
          <h2><Clock size={15} /> Awaiting your approval ({pendingApproval.length})</h2>
          {pendingApproval.map((n) => (
            <div key={n.id} className="nb-pending">
              <div className="nb-pending-body">
                <strong>{n.title}</strong>
                {n.body ? <p>{n.body}</p> : null}
                <span className="nb-muted">By {n.author_email || "staff"}</span>
              </div>
              <div className="nb-pending-actions">
                <button className="nb-approve" onClick={() => act(n.id, "approve")}><Check size={14} /> Approve</button>
                <button className="nb-decline" onClick={() => { const note = window.prompt("Reason for declining (optional):") ?? ""; act(n.id, "decline", { adminNote: note }); }}><X size={14} /> Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Compose */}
      <section className="nb-section">
        {composing ? (
          <div className="nb-compose">
            <input placeholder="Notice title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input placeholder="Category (optional)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <textarea placeholder="Write your notice…" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            <div className="nb-compose-actions">
              <button className="nb-save" onClick={() => createNotice(true)}><Send size={13} /> Submit for approval</button>
              <button className="nb-secondary" onClick={() => createNotice(false)}>Save draft</button>
              <button className="nb-secondary" onClick={() => { setComposing(false); setForm({ title: "", body: "", category: "" }); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="nb-new" onClick={() => setComposing(true)}><Plus size={14} /> New notice</button>
        )}
      </section>

      {/* Author's own drafts/submissions */}
      {mine.length > 0 && (
        <section className="nb-section">
          <h3 className="nb-subhead">My notices</h3>
          {mine.map((n) => {
            const meta = STATUS_META[n.status];
            return (
              <div key={n.id} className="nb-mine">
                <div className="nb-mine-main">
                  <strong>{n.title}</strong>
                  <span className="nb-status" style={{ background: `${meta.color}1a`, color: meta.color }}>{meta.label}</span>
                </div>
                {n.admin_note ? <p className="nb-decline-note">Admin: {n.admin_note}</p> : null}
                <div className="nb-mine-actions">
                  {n.status === "approved" && <button className="nb-publish" onClick={() => act(n.id, "publish")}>Publish to board</button>}
                  {(n.status === "draft" || n.status === "declined") && <button className="nb-save" onClick={() => act(n.id, "submit")}><Send size={12} /> Submit for approval</button>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Published board */}
      <section className="nb-section">
        {!compact && <h3 className="nb-subhead">Published notices</h3>}
        {published.length ? (
          <div className="nb-board">
            {published.map((n) => (
              <article key={n.id} className="nb-notice">
                <div className="nb-notice-head">
                  <strong>{n.title}</strong>
                  {n.category ? <span className="nb-cat">{n.category}</span> : null}
                </div>
                {n.body ? <p>{n.body}</p> : null}
                <div className="nb-notice-foot">
                  <span className="nb-muted">{n.author_email || "staff"}{n.published_at ? ` · ${new Date(n.published_at).toLocaleDateString("en-AU")}` : ""}</span>
                  {isAdmin && n.read_count !== undefined ? <span className="nb-reads"><Eye size={12} /> {n.read_count} read</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="nb-empty">No published notices yet.</p>}
      </section>
    </div>
  );
}
