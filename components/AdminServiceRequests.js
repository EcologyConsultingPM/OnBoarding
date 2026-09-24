"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleCheckBig,
  Lock,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS_STYLE = {
  submitted: { bg: "#fbf1dd", fg: "#95661f", label: "Awaiting decision" },
  approved: { bg: "#e5f1dd", fg: "#2c6a34", label: "Approved" },
  declined: { bg: "#fbecea", fg: "#a5342a", label: "Denied" },
  closed: { bg: "#e7f0e5", fg: "#2d6540", label: "Closed & locked" },
  returned: { bg: "#fff0dc", fg: "#a55a20", label: "Returned (legacy)" },
  assigned: { bg: "#e0edf4", fg: "#1f5871", label: "Assigned (legacy)" },
  in_progress: { bg: "#e6edf5", fg: "#315e87", label: "In progress (legacy)" },
  archived: { bg: "#eef0e9", fg: "#66715d", label: "Archived" },
  cancelled: { bg: "#eef0e9", fg: "#6b755f", label: "Cancelled" },
};

const labelFor = (key) => String(key || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value) => value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "";
const isDecision = (request) => ["approved", "declined"].includes(request.status);

export default function AdminServiceRequests() {
  const { session } = useAuth();
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionFor, setActionFor] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const auth = useCallback(
    (method, url, body) => fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: body ? JSON.stringify(body) : undefined,
    }),
    [session?.access_token],
  );

  const load = useCallback(async () => {
    try {
      const response = await auth("GET", "/api/service-requests");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load service requests.");
      setRequests(data.requests || []);
      setSummary(data.summary || null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [auth]);

  useEffect(() => {
    if (session?.access_token) load();
  }, [session?.access_token, load]);

  const act = async (request, action) => {
    try {
      setBusy(true);
      setError("");
      const response = await auth("PATCH", `/api/service-requests/${request.id}`, { action, note });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the request action.");
      setActionFor(null);
      setNote("");
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  };

  const visible = requests.filter((item) => (
    (typeFilter === "all" || item.request_type === typeFilter)
    && (statusFilter === "all" || item.status === statusFilter)
  ));
  const detailLine = (item) => Object.entries(item.details || {})
    .filter(([, value]) => value != null && String(value).trim())
    .map(([key, value]) => `${labelFor(key)}: ${value}`)
    .join(" · ");

  return (
    <div className="sr admin-service-requests">
      <header className="sr-hero">
        <span>Ecology Consulting · Service desk</span>
        <h1>Service requests</h1>
        <p>Record a comment, make an approval or denial decision, then close and lock the completed request. Every decision identifies the administrator who made it.</p>
      </header>

      {summary ? <div className="sr-summary"><div className="sr-sum"><div className="sr-sum-v" style={{ color: summary.pending ? "#a5772b" : "#2c6a34" }}>{summary.pending}</div><div className="sr-sum-l">Awaiting decision</div></div><div className="sr-sum"><div className="sr-sum-v">{summary.total}</div><div className="sr-sum-l">Total requests</div></div></div> : null}
      {error ? <p className="sr-error" role="alert"><AlertTriangle size={15} /> {error}</p> : null}

      <div className="sr-controls">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="submitted">Awaiting decision</option>
          <option value="approved">Approved</option>
          <option value="declined">Denied</option>
          <option value="closed">Closed & locked</option>
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by request type">
          <option value="all">All types</option>
          <option value="leave">Leave</option>
          <option value="training">Training</option>
          <option value="equipment">Equipment</option>
          <option value="task">Task</option>
          <option value="other">Other</option>
        </select>
        <span className="sr-count">{visible.length} shown</span>
      </div>

      <div className="sr-list">
        {visible.length ? visible.map((item) => {
          const style = STATUS_STYLE[item.status] || STATUS_STYLE.submitted;
          const isOpen = actionFor === item.id;
          const canAction = !item.locked && !["closed", "archived", "cancelled"].includes(item.status);
          const decisionVerb = item.status === "approved" ? "Approved" : "Denied";

          return (
            <article key={item.id} className="sr-card">
              <div className="sr-card-top">
                <div>
                  <div className="sr-title">{item.title}</div>
                  <div className="sr-meta">{item.author || "Unknown"} · {new Date(item.created_at).toLocaleDateString("en-AU")} · <span className="sr-type">{item.request_type}</span>{item.priority ? ` · ${item.priority}` : ""}</div>
                </div>
                <span className="sr-status" style={{ background: style.bg, color: style.fg }}>{style.label}</span>
              </div>

              {detailLine(item) ? <div className="sr-detail">{detailLine(item)}</div> : null}
              {item.admin_note ? <div className="sr-note"><strong>Comment:</strong> {item.admin_note}</div> : null}
              {isDecision(item) ? <div className={`sr-decision sr-decision--${item.status}`}><UserRoundCheck size={14} /><span><strong>{decisionVerb} by:</strong> {item.decisionBy || "Administrator"}{item.reviewed_at ? ` · ${dateTime(item.reviewed_at)}` : ""}</span></div> : null}
              {item.locked ? <p className="sr-locked"><Lock size={13} /> Locked record</p> : null}

              {canAction ? (
                <>
                  {isOpen ? (
                    <div className="sr-decide">
                      {error ? <p className="sr-inline-error"><AlertTriangle size={13} /> {error}</p> : null}
                      <label className="sr-comment-label" htmlFor={`request-comment-${item.id}`}>Comment <span>(optional)</span></label>
                      <textarea id={`request-comment-${item.id}`} className="sr-comment" rows={3} placeholder="Add the decision context or close-out comment…" value={note} onChange={(event) => setNote(event.target.value)} />
                      <div className="sr-action-row">
                        <button disabled={busy} className="sr-btn sr-btn--positive" onClick={() => act(item, "approve")}><CheckCircle2 size={14} /> Approve</button>
                        <button disabled={busy} className="sr-btn sr-btn--destructive" onClick={() => act(item, "decline")}><XCircle size={14} /> Deny</button>
                        <button disabled={busy} className="sr-btn sr-btn--caution" onClick={() => act(item, "close")}><CircleCheckBig size={14} /> Close &amp; lock</button>
                      </div>
                    </div>
                  ) : null}
                  <button className="sr-review" aria-expanded={isOpen} onClick={() => { setActionFor(isOpen ? null : item.id); setNote(""); }}><ShieldCheck size={14} /> {isOpen ? "Hide review" : "Review & action"}</button>
                </>
              ) : null}
            </article>
          );
        }) : <p className="sr-empty">Nothing here. No requests match this filter.</p>}
      </div>
    </div>
  );
}
