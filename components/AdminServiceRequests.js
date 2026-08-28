"use client";

import { useEffect, useState, useCallback } from "react";
import { Inbox, CheckCircle2, XCircle, AlertCircle, Clock } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const STATUS_STYLE = {
  submitted: { bg: "#fbf1dd", fg: "#a5772b", label: "Submitted" },
  approved: { bg: "#e5f1dd", fg: "#2c6a34", label: "Approved" },
  declined: { bg: "#fbecea", fg: "#a5342a", label: "Declined" },
  cancelled: { bg: "#eef0e9", fg: "#6b755f", label: "Cancelled" },
};

export default function AdminServiceRequests() {
  const { session } = useAuth();
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState("");

  const auth = useCallback((method, url, body) => fetch(url, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), [session]);

  const load = useCallback(async () => {
    try {
      const res = await auth("GET", "/api/service-requests");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRequests(data.requests); setSummary(data.summary);
    } catch (e) { setError(e.message); }
  }, [auth]);

  useEffect(() => { if (session?.access_token) load(); }, [session, load]);

  const act = async (id, action) => {
    try {
      const res = await auth("PATCH", `/api/service-requests/${id}`, { action, admin_note: note });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setNoteFor(null); setNote(""); await load();
    } catch (e) { setError(e.message); }
  };

  const visible = requests.filter((r) =>
    (typeFilter === "all" || r.request_type === typeFilter) &&
    (statusFilter === "all" || r.status === statusFilter)
  );

  const detailLine = (r) => Object.entries(r.details || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");

  return (
    <div className="sr admin-service-requests">
      <header className="sr-hero">
        <span>Ecology Consulting · Service desk</span>
        <h1>Service requests</h1>
        <p>Staff submissions awaiting a decision — leave, training and equipment. Approve or decline, with an optional note back to the person.</p>
      </header>

      {summary ? (
        <div className="sr-summary">
          <div className="sr-sum"><div className="sr-sum-v" style={{ color: summary.pending ? "#a5772b" : "#2c6a34" }}>{summary.pending}</div><div className="sr-sum-l">Awaiting decision</div></div>
          <div className="sr-sum"><div className="sr-sum-v">{summary.total}</div><div className="sr-sum-l">Total requests</div></div>
        </div>
      ) : null}

      {error ? <p className="sr-error"><AlertCircle size={15} /> {error}</p> : null}

      <div className="sr-controls">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="submitted">Awaiting decision</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All statuses</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="leave">Leave</option>
          <option value="training">Training</option>
          <option value="equipment">Equipment</option>
          <option value="whs_incident">WHS: Injury/Incident</option>
          <option value="whs_near_miss">WHS: Near miss</option>
        </select>
        <span className="sr-count">{visible.length} shown</span>
      </div>

      <div className="sr-list">
        {visible.length ? visible.map((r) => {
          const st = STATUS_STYLE[r.status] || STATUS_STYLE.submitted;
          return (
            <div key={r.id} className="sr-card">
              <div className="sr-card-top">
                <div>
                  <div className="sr-title">{r.title}</div>
                  <div className="sr-meta">{r.author || "Unknown"} · {new Date(r.created_at).toLocaleDateString("en-AU")} · <span className="sr-type">{r.request_type}</span></div>
                </div>
                <span className="sr-status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              </div>
              {detailLine(r) ? <div className="sr-detail">{detailLine(r)}</div> : null}
              {r.admin_note ? <div className="sr-note">Note: {r.admin_note}</div> : null}

              {r.status === "submitted" && (
                noteFor === r.id ? (
                  <div className="sr-decide">
                    <input placeholder="Optional note back to the person" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="sr-approve" onClick={() => act(r.id, "approve")}><CheckCircle2 size={14} /> Approve</button>
                    <button className="sr-decline" onClick={() => act(r.id, "decline")}><XCircle size={14} /> Decline</button>
                    <button className="sr-cancelbtn" onClick={() => { setNoteFor(null); setNote(""); }}>Back</button>
                  </div>
                ) : (
                  <button className="sr-review" onClick={() => { setNoteFor(r.id); setNote(""); }}>Review</button>
                )
              )}
            </div>
          );
        }) : <p className="sr-empty">Nothing here. {statusFilter === "submitted" ? "No requests are awaiting a decision." : "No requests match this filter."}</p>}
      </div>
    </div>
  );
}
