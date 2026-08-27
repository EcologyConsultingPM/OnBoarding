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

  if (loading) return <div className="portal-events-loading"><Loader2 className="spin" size={16} /> Loading updates…</div>;
  if (!events.length) return <div className="portal-events-empty"><CheckCircle2 size={17} /><span>No new actions. Your work and governance updates will appear here.</span></div>;

  return <div className="portal-events-list">
    {events.map((event) => {
      const style = SEVERITY[event.severity] || SEVERITY.information;
      const Icon = style.Icon;
      return <button key={event.id} className={`portal-event ${event.severity || "information"}${event.read_at ? " read" : ""}`} onClick={() => openEvent(event)}>
        <span className="portal-event-icon"><Icon size={14} /></span>
        <span className="portal-event-copy"><strong>{event.title}</strong>{event.body ? <small>{event.body}</small> : null}<em>{style.label} · {relativeDate(event.created_at)}</em></span>
        {event.href ? <ExternalLink size={13} className="portal-event-arrow" /> : null}
      </button>;
    })}
  </div>;
}
