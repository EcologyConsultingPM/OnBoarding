import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const SEVERITY = {
  information: { label: "Update", Icon: CheckCircle2 },
  review: { label: "Review", Icon: ClipboardCheck },
  approval: { label: "Approval", Icon: BellRing },
  action_required: { label: "Action required", Icon: AlertTriangle },
  critical: { label: "Immediate action", Icon: ShieldAlert },
};

function relativeDate(value) {
  const then = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMinutes < 60) return `${diffMinutes || 1}m ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
  if (diffMinutes < 10080) return `${Math.round(diffMinutes / 1440)}d ago`;
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Embedded in the existing Staff noticeboard card. It intentionally has no extra
// page title: the home card heading is retained as the single label.
export default function StaffPortalEvents({ limit = 5 }) {
  const { session } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState("");
  const [error, setError] = useState("");

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" }), [session?.access_token]);
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const response = await fetch(`/api/portal-events?limit=${limit}`, { headers: headers() });
      const data = await response.json();
      if (response.ok) setEvents(data.events || []);
    } finally {
      setLoading(false);
    }
  }, [headers, limit, session?.access_token]);

  useEffect(() => { load(); }, [load]);

  const openEvent = async (event) => {
    if (!event.read_at) {
      setEvents((records) => records.map((record) => record.id === event.id ? { ...record, read_at: new Date().toISOString() } : record));
      fetch("/api/portal-events", { method: "PATCH", headers: headers(), body: JSON.stringify({ id: event.id }) }).catch(() => {});
    }
    if (event.href) window.location.href = event.href;
  };

  const respondToProjectActivity = async (event, action) => {
    const decline = action === "decline";
    const promptText = decline
      ? "Please provide the reason or reassignment request."
      : action === "accept"
        ? "Optional acceptance comment for the Project Manager:"
        : "Optional actioned comment for the Project Manager:";
    const responseNote = window.prompt(promptText, "");
    if (responseNote === null) return;
    if (decline && !responseNote.trim()) {
      setError("A reason or reassignment request is required when declining an activity.");
      return;
    }
    setResponding(`${event.id}:${action}`);
    setError("");
    try {
      const response = await fetch(`/api/my-activities?id=${event.source_id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ action, responseNote }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save your activity response.");
      setEvents((records) => records.map((record) => record.id === event.id ? { ...record, read_at: new Date().toISOString(), response_action: action } : record));
    } catch (requestError) {
      setError(requestError.message || "Could not save your activity response.");
    } finally {
      setResponding("");
    }
  };

  if (loading) return <div className="portal-events-loading"><Loader2 className="spin" size={16} /> Loading updates…</div>;
  if (!events.length) return <div className="portal-events-empty"><CheckCircle2 size={17} /><span>No new actions. Your work and governance updates will appear here.</span></div>;

  return <div className="portal-events-list">
    {error ? <p className="portal-events-error"><AlertTriangle size={14} /> {error}</p> : null}
    {events.map((event) => {
      const style = SEVERITY[event.severity] || SEVERITY.information;
      const Icon = style.Icon;
      const activityResponse = event.source_table === "project_activities" && event.event_type === "project_activity_assigned" && !event.read_at && !event.response_action;
      return <article key={event.id} className={`portal-event ${event.severity || "information"}${event.read_at ? " read" : ""}`}>
        <button type="button" className="portal-event-open" onClick={() => openEvent(event)}>
          <span className="portal-event-icon"><Icon size={14} /></span>
          <span className="portal-event-copy"><strong>{event.title}</strong>{event.body ? <small>{event.body}</small> : null}<em>{style.label} · {relativeDate(event.created_at)}</em></span>
          {event.href ? <ExternalLink size={13} className="portal-event-arrow" /> : null}
        </button>
        {activityResponse ? <div className="portal-event-actions" aria-label="Project activity response">
          <button type="button" className="accept" disabled={Boolean(responding)} onClick={() => respondToProjectActivity(event, "accept")}>{responding === `${event.id}:accept` ? "Saving…" : "Accept"}</button>
          <button type="button" className="actioned" disabled={Boolean(responding)} onClick={() => respondToProjectActivity(event, "actioned")}>{responding === `${event.id}:actioned` ? "Saving…" : "Actioned"}</button>
          <button type="button" className="decline" disabled={Boolean(responding)} onClick={() => respondToProjectActivity(event, "decline")}>{responding === `${event.id}:decline` ? "Saving…" : "Decline"}</button>
        </div> : null}
      </article>;
    })}
  </div>;
}
