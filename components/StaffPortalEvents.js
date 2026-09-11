import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, CheckCircle2, ClipboardCheck, ExternalLink, Loader2, ShieldAlert, Trash2, Clock3, ChevronDown, XCircle } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const SEVERITY = {
  information: { label: "Update", Icon: CheckCircle2 },
  review: { label: "Review", Icon: ClipboardCheck },
  approval: { label: "Approval", Icon: BellRing },
  action_required: { label: "Action required", Icon: AlertTriangle },
  critical: { label: "Immediate action", Icon: ShieldAlert },
};

const RESPONSE_LABEL = {
  accepted: "Accepted",
  declined: "Declined / reassignment requested",
  actioned: "Actioned",
};

function relativeDate(value) {
  const then = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMinutes < 60) return `${diffMinutes || 1}m ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
  if (diffMinutes < 10080) return `${Math.round(diffMinutes / 1440)}d ago`;
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// Operational notifications are rendered only in the dedicated Notifications
// workspace. Published communications remain in the separate Staff Noticeboard.
const NO_EXCLUSIONS = [];

// One activity can carry more than one notification: regenerating a project's
// Work Activities deactivates the old rows and inserts replacements, and the
// replacement passes the server's `notified_at IS NULL` guard, so approval
// emits a second, byte-identical card. Collapse them here, preferring the row
// that still resolves to a live activity so the surviving card is actionable.
function dedupeEvents(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = event.source_id
      ? `${event.source_table}:${event.source_id}:${event.event_type}`
      : `id:${event.id}`;
    const held = byKey.get(key);
    if (!held) { byKey.set(key, event); continue; }
    const heldIsLive = held.activity_exists !== false && held.activity_active !== false;
    const nextIsLive = event.activity_exists !== false && event.activity_active !== false;
    if (nextIsLive && !heldIsLive) byKey.set(key, event);
    else if (nextIsLive === heldIsLive && new Date(event.created_at) > new Date(held.created_at)) byKey.set(key, event);
  }
  return [...byKey.values()];
}

// `activity_exists` / `activity_active` / `acceptance_status` are projected onto
// the event by /api/portal-events. Until that ships these are undefined, so
// every check is written to fail open — behaviour is unchanged on an old API,
// and tightens automatically once the join lands.
function activityState(event) {
  if (event.source_table !== "project_activities" || event.event_type !== "project_activity_assigned") return "not_activity";
  if (event.activity_exists === false || event.activity_active === false) return "orphaned";
  if (event.acceptance_status && event.acceptance_status !== "awaiting_response") return "resolved";
  return "awaiting";
}

export default function StaffPortalEvents({ limit = 5, excludeTypes = NO_EXCLUSIONS }) {
  const router = useRouter();
  const { session } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState("");
  const [notes, setNotes] = useState({});
  const [pendingAction, setPendingAction] = useState(null);

  // Guards against an inline array literal from a caller (excludeTypes={["x"]})
  // creating a new identity every render, which would make `load` unstable and
  // refetch in a loop.
  const excludeKey = excludeTypes.join("|");
  const exclusions = useMemo(() => excludeTypes, [excludeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const headers = useCallback(() => ({ Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" }), [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const response = await fetch(`/api/portal-events?limit=${limit}`, { headers: headers() });
      const data = await response.json().catch(() => ({}));
      // Previously `if (response.ok) setEvents(...)` with no else, so a failed
      // load rendered the "No new actions" empty state and the real error was
      // never shown.
      if (!response.ok) { setError(data.error || "Could not load your updates."); return; }
      setError("");
      setEvents(dedupeEvents((data.events || []).filter((event) => !exclusions.includes(event.event_type))));
    } catch {
      setError("Could not load your updates. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [headers, limit, session?.access_token, exclusions]);

  useEffect(() => { load(); }, [load]);

  const markRead = useCallback((event) => {
    if (event.read_at) return;
    setEvents((records) => records.map((record) => record.id === event.id ? { ...record, read_at: new Date().toISOString() } : record));
    fetch("/api/portal-events", { method: "PATCH", headers: headers(), body: JSON.stringify({ id: event.id }) }).catch(() => {});
  }, [headers]);

  // The approval emitter sets href to "/staff/notifications" — the page the card
  // is already on — so this used to hard-reload the current page via
  // window.location.href and appear to do nothing. Ignore self-links, and use
  // the router so SPA state (and any in-progress form) survives.
  const openEvent = (event) => {
    markRead(event);
    if (!event.href) return;
    const [path] = event.href.split("?");
    if (typeof window !== "undefined" && path === window.location.pathname) {
      setExpanded((current) => (current === event.id ? "" : event.id));
      return;
    }
    router.push(event.href);
  };

  const manageEvent = async (event, action) => {
    if (action === "delete" && !window.confirm("Delete this notification from your inbox? The underlying project or workflow record will be retained.")) return;
    setResponding(`${event.id}:${action}`);
    setError("");
    try {
      const response = await fetch("/api/portal-events", { method: "PATCH", headers: headers(), body: JSON.stringify({ id: event.id, action }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not update this notification.");
      // Deferred and deleted events leave the active inbox immediately. A deferred
      // event becomes visible again after the server-set reminder period.
      setEvents((records) => records.filter((record) => record.id !== event.id));
      setNotice(action === "defer" ? "Deferred for one day." : "Notification deleted.");
    } catch (requestError) {
      setError(requestError.message || "Could not update this notification.");
    } finally {
      setResponding("");
    }
  };

  const respondToProjectActivity = async (event, action) => {
    const responseNote = (notes[event.id] || "").trim();
    if (action === "decline" && !responseNote) {
      setError("A reason or reassignment request is required when declining an activity.");
      setExpanded(event.id);
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
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        // 404 => the activity row is gone or is_active=false, i.e. the project
        // lead withdrew or regenerated it after this notification was sent.
        // 409 => already responded to, usually via a duplicate card.
        if (response.status === 404) {
          setEvents((records) => records.map((record) => record.id === event.id
            ? { ...record, activity_exists: false, activity_active: false }
            : record));
          throw new Error("This activity was withdrawn or replaced by the project lead. No action is needed — you can dismiss this notification.");
        }
        if (response.status === 409) {
          setEvents((records) => records.map((record) => record.id === event.id
            ? { ...record, acceptance_status: payload.acceptance_status || "accepted" }
            : record));
          throw new Error(payload.error || "This activity has already been responded to.");
        }
        throw new Error(payload.error || "Could not save your activity response.");
      }

      // The response is recorded on the project activity and in the administrator
      // workflow audit. The notification is NOT deleted: for an ISO 45001-aligned
      // portal the record of who accepted or declined a field activity has to
      // survive. It is marked read and re-rendered in a resolved state, which
      // also prevents a second response (the server returns 409) while leaving
      // the trail intact.
      const accepted = payload.activity?.acceptance_status || (action === "accept" ? "accepted" : action === "decline" ? "declined" : "actioned");
      await fetch("/api/portal-events", { method: "PATCH", headers: headers(), body: JSON.stringify({ id: event.id }) }).catch(() => {});
      setEvents((records) => records.map((record) => record.id === event.id
        ? { ...record, acceptance_status: accepted, response_note: responseNote, read_at: new Date().toISOString() }
        : record));
      setNotes((current) => ({ ...current, [event.id]: "" }));
      setExpanded("");
      setNotice(`${RESPONSE_LABEL[accepted] || "Response"} recorded and sent to the Project Manager.`);

      if (payload.schedule_warning || payload.event_warning) {
        setError(`Saved, but: ${[payload.schedule_warning, payload.event_warning].filter(Boolean).join(" · ")}`);
      }
    } catch (requestError) {
      setError(requestError.message || "Could not save your activity response.");
    } finally {
      setResponding("");
      setPendingAction(null);
    }
  };

  if (loading) return <div className="portal-events-loading"><Loader2 className="spin" size={16} /> Loading updates…</div>;

  // The error was previously unreachable when the list was empty, because the
  // empty state returned before the error was rendered.
  const banners = <>
    {error ? <p className="portal-events-error"><AlertTriangle size={14} /> {error}</p> : null}
    {notice ? <p className="portal-events-notice"><CheckCircle2 size={14} /> {notice}</p> : null}
  </>;

  if (!events.length) return <div className="portal-events-empty">{banners}<CheckCircle2 size={17} /><span>No new actions. Your work and governance updates will appear here.</span></div>;

  return <div className="portal-events-list">
    {banners}
    {events.map((event) => {
      const style = SEVERITY[event.severity] || SEVERITY.information;
      const Icon = style.Icon;
      const state = activityState(event);
      const isActivity = state !== "not_activity";
      const busy = responding.startsWith(`${event.id}:`);
      const open = expanded === event.id;
      const hasDetail = Boolean(event.project_name || event.due_date || event.location || event.detail);

      return <article key={event.id} className={`portal-event ${event.severity || "information"}${event.read_at ? " read" : ""}${state === "orphaned" ? " expired" : ""}`}>
        <button type="button" className="portal-event-open" onClick={() => openEvent(event)}>
          <span className="portal-event-icon"><Icon size={14} /></span>
          <span className="portal-event-copy">
            <strong>{event.title}</strong>
            {event.body ? <small>{event.body}</small> : null}
            <em>{style.label} · {relativeDate(event.created_at)}</em>
          </span>
          {event.href ? <ExternalLink size={13} className="portal-event-arrow" /> : null}
        </button>

        {isActivity && (hasDetail || state === "awaiting") ? <button
          type="button"
          className="portal-event-expand"
          aria-expanded={open}
          onClick={() => setExpanded(open ? "" : event.id)}
        >
          <ChevronDown size={13} /> {open ? "Hide activity" : "View activity"}
        </button> : null}

        {open ? <dl className="portal-event-detail">
          <div><dt>Project</dt><dd>{event.project_name || "—"}</dd></div>
          <div><dt>Activity</dt><dd>{event.activity_title || "—"}</dd></div>
          <div><dt>Due</dt><dd>{formatDate(event.due_date) || "—"}</dd></div>
          <div><dt>Category</dt><dd>{event.task_category || "—"}</dd></div>
          <div><dt>Budget hours</dt><dd>{event.budget_hours ?? "—"}</dd></div>
          <div><dt>Detail</dt><dd>{event.detail || event.body || "—"}</dd></div>
        </dl> : null}

        <div className="portal-event-actions" aria-label={state === "awaiting" ? "Project activity response" : "Notification actions"}>
          {state === "orphaned" ? <p className="portal-event-expired-note">
            <XCircle size={13} /> This activity was withdrawn or replaced by the project lead. No action needed.
          </p> : null}

          {state === "resolved" ? <p className="portal-event-resolved">
            <CheckCircle2 size={13} /> {RESPONSE_LABEL[event.acceptance_status] || event.acceptance_status}
            {event.response_note ? <span className="portal-event-resolved-note"> · {event.response_note}</span> : null}
          </p> : null}

          {state === "awaiting" ? <>
            {/* window.prompt() replaced: it is blocked by some browsers, cannot be
                styled or validated inline, and is poor on mobile. The decline
                reason is now validated before the request is sent. */}
            {open || pendingAction?.id === event.id ? <textarea
              className="portal-event-note"
              rows={2}
              value={notes[event.id] || ""}
              onChange={(changeEvent) => setNotes((current) => ({ ...current, [event.id]: changeEvent.target.value }))}
              placeholder={pendingAction?.action === "decline"
                ? "Reason or reassignment request (required)"
                : "Optional comment for the Project Manager"}
            /> : null}

            <button type="button" className="accept" disabled={busy} onClick={() => { setPendingAction({ id: event.id, action: "accept" }); respondToProjectActivity(event, "accept"); }}>
              {responding === `${event.id}:accept` ? "Saving…" : "Accept"}
            </button>
            <button type="button" className="actioned" disabled={busy} onClick={() => { setPendingAction({ id: event.id, action: "actioned" }); respondToProjectActivity(event, "actioned"); }}>
              {responding === `${event.id}:actioned` ? "Saving…" : "Actioned"}
            </button>
            <button type="button" className="decline" disabled={busy} onClick={() => {
              // Surface the textarea first so the required reason can be typed,
              // rather than validating after a modal prompt has already closed.
              setPendingAction({ id: event.id, action: "decline" });
              if (!(notes[event.id] || "").trim()) { setExpanded(event.id); setError("Add a reason or reassignment request, then press Decline again."); return; }
              respondToProjectActivity(event, "decline");
            }}>
              {responding === `${event.id}:decline` ? "Saving…" : "Decline"}
            </button>
          </> : null}

          {/* Previously disabled={Boolean(responding)} — one in-flight response
              disabled every button on every card. Scoped to this card. */}
          <button type="button" className="defer" disabled={busy} onClick={() => manageEvent(event, "defer")}>
            <Clock3 size={13} /> {responding === `${event.id}:defer` ? "Deferring…" : "Defer 1 day"}
          </button>
          <button type="button" className="delete" disabled={busy} onClick={() => manageEvent(event, "delete")}>
            <Trash2 size={13} /> {responding === `${event.id}:delete` ? "Deleting…" : "Delete"}
          </button>
        </div>
      </article>;
    })}
  </div>;
}
