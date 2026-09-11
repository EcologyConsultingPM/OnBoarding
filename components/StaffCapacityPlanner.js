"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Edit3, Loader2, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";
import useUnsavedGuard from "../lib/useUnsavedGuard";

const STATUS = {
  available: { label: "Available", color: "#469b69" },
  near_capacity: { label: "Near capacity", color: "#d5983d" },
  full: { label: "Full capacity", color: "#c76347" },
  over_capacity: { label: "Over capacity", color: "#8e2f2f" },
  on_leave: { label: "On leave", color: "#8d62ab" },
};

const EVENT = {
  activity: { label: "Project activity", color: "#3f7eae" },
  field_survey: { label: "Field survey", color: "#469b69" },
  task_brief: { label: "Task brief", color: "#2f8f8f" },
  leave: { label: "Approved leave", color: "#c76347" },
  schedule: { label: "Schedule", color: "#d5b243" },
  milestone: { label: "Milestone", color: "#8d62ab" },
};

const DAY = 24 * 60 * 60 * 1000;

function dateText(value, options = { day: "numeric", month: "short" }) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-AU", options);
}

function localDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function shiftDate(value, count) {
  const d = new Date(`${value}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return localDate(d);
}

function weekStart(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return localDate(date);
}

function monthStart(value) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return localDate(date);
}

function monthEnd(value) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return localDate(date);
}

function yearStart(value) {
  return `${value.slice(0, 4)}-01-01`;
}

function yearEnd(value) {
  return `${value.slice(0, 4)}-12-31`;
}

function shiftMonth(value, count) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return localDate(date);
}

function shiftYear(value, count) {
  const date = new Date(`${value.slice(0, 4)}-01-01T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + count);
  return localDate(date);
}

function eventFallsOn(event, date) {
  const start = String(event.date || event.startDate || "").slice(0, 10);
  const end = String(event.endDate || start).slice(0, 10);
  return start && start <= date && end >= date;
}

function periodFor(mode, anchorDate, customStart, customEnd) {
  if (mode === "month") {
    const start = monthStart(anchorDate);
    return { start, end: monthEnd(start) };
  }
  if (mode === "year") {
    return { start: yearStart(anchorDate), end: yearEnd(anchorDate) };
  }
  if (mode === "range") {
    return { start: customStart, end: customEnd };
  }
  const start = weekStart(anchorDate);
  return { start, end: shiftDate(start, 6) };
}

function periodLabel(mode, start, end) {
  if (mode === "year") return start.slice(0, 4);
  if (mode === "month") return dateText(start, { month: "long", year: "numeric" });
  const first = dateText(start, { day: "numeric", month: "short", year: "numeric" });
  const last = dateText(end, { day: "numeric", month: "short", year: "numeric" });
  return first === last ? first : `${first} – ${last}`;
}

export default function StaffCapacityPlanner({ compact = false, onSelectStaff = null, mode = "admin" }) {
  const { session } = useAuth();
  const endpoint = mode === "staff" ? "/api/staff/capacity" : "/api/admin/staff-capacity";
  const today = localDate();
  const [viewMode, setViewMode] = useState("week");
  const [anchorDate, setAnchorDate] = useState(today);
  const [customStart, setCustomStart] = useState(weekStart(today));
  const [customEnd, setCustomEnd] = useState(shiftDate(weekStart(today), 6));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({});

  // Inline per-person editor: contracted weekly hours and a note. Two fields
  // saved immediately, so localStorage draft retention would be more machinery
  // than the risk warrants — but closing the row still discards typing, and
  // capacity figures feed the whole resourcing picture.
  const capacityDirty = Boolean(
    editing &&
    draft[editing] &&
    (String(draft[editing].weeklyCapacityHours ?? "") !== String(
      (data?.people || []).find((p) => p.id === editing)?.weeklyCapacityHours ?? "",
    ) ||
      String(draft[editing].notes ?? "") !== String(
        (data?.people || []).find((p) => p.id === editing)?.notes ?? "",
      )),
  );

  useUnsavedGuard(capacityDirty, "A capacity change has not been saved.");
  const [saving, setSaving] = useState(false);
  const [unassignedModal, setUnassignedModal] = useState(null); // admin: { activityId, projectId, title, taskCategory, budgetHours, startDate, dueDate, staffUserId }
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [claimRequest, setClaimRequest] = useState(null); // staff: the event being confirmed for a service request
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");

  const period = useMemo(
    () => periodFor(viewMode, anchorDate, customStart, customEnd),
    [viewMode, anchorDate, customStart, customEnd],
  );

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}?start=${period.start}&end=${period.end}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load staff capacity.");
      setData(payload);
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Could not load staff capacity.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, period.start, period.end, endpoint]);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async (person) => {
    if (mode === "staff") return;
    const candidate = draft[person.id] || { weeklyCapacityHours: person.weeklyCapacityHours, notes: person.notes || "" };
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ userId: person.id, weeklyCapacityHours: candidate.weeklyCapacityHours, notes: candidate.notes }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save contracted hours.");
      setEditing("");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Could not save contracted hours.");
    } finally {
      setSaving(false);
    }
  };

  // --- Admin: manage an unassigned activity from the calendar ---
  const openUnassignedModal = (event) => {
    if (mode === "staff" || !data?.canEdit) return;
    if (!["activity", "field_survey"].includes(event.type) || !event.projectId) return;
    const activityId = event.id.replace(/^activity-/, "");
    setModalError("");
    setUnassignedModal({
      activityId,
      projectId: event.projectId,
      projectName: event.projectName,
      title: event.title,
      startDate: event.startDate || "",
      dueDate: event.endDate || "",
      staffUserId: "",
    });
  };
  const saveUnassignedAssignment = async () => {
    if (!unassignedModal) return;
    if (!unassignedModal.staffUserId) { setModalError("Choose a staff member, or use Delete if this activity is no longer needed."); return; }
    setModalBusy(true);
    setModalError("");
    try {
      const response = await fetch(`/api/projects/${unassignedModal.projectId}/activities/${unassignedModal.activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          staffUserId: unassignedModal.staffUserId,
          title: unassignedModal.title,
          startDate: unassignedModal.startDate || undefined,
          dueDate: unassignedModal.dueDate || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not assign this activity.");
      setUnassignedModal(null);
      await load();
    } catch (assignError) {
      setModalError(assignError.message || "Could not assign this activity.");
    } finally {
      setModalBusy(false);
    }
  };
  const deleteUnassignedActivity = async () => {
    if (!unassignedModal) return;
    if (!window.confirm(`Delete "${unassignedModal.title}"? This can't be undone.`)) return;
    setModalBusy(true);
    setModalError("");
    try {
      const response = await fetch(`/api/projects/${unassignedModal.projectId}/activities?id=${unassignedModal.activityId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete this activity.");
      setUnassignedModal(null);
      await load();
    } catch (deleteError) {
      setModalError(deleteError.message || "Could not delete this activity.");
    } finally {
      setModalBusy(false);
    }
  };

  // --- Staff: request unassigned work via a service request ---
  const openClaimRequest = (event) => {
    if (mode !== "staff") return;
    if (!["activity", "field_survey"].includes(event.type) || !event.projectId) return;
    setClaimMessage("");
    setClaimRequest(event);
  };
  const submitClaimRequest = async () => {
    if (!claimRequest) return;
    setClaimBusy(true);
    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          request_type: "task",
          title: `Take on: ${claimRequest.title}`,
          projectId: claimRequest.projectId,
          details: {
            source: "capacity_calendar_unassigned",
            note: `Unassigned work seen on the workload calendar for ${claimRequest.projectName}: "${claimRequest.title}". Requesting this be assigned to me.`,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not submit the service request.");
      setClaimMessage(`Submitted — a service request has been raised to take on "${claimRequest.title}".`);
      setTimeout(() => { setClaimRequest(null); setClaimMessage(""); }, 2500);
    } catch (claimError) {
      setClaimMessage(claimError.message || "Could not submit the service request.");
    } finally {
      setClaimBusy(false);
    }
  };

  const movePeriod = (direction) => {
    if (viewMode === "month") {
      setAnchorDate(shiftMonth(anchorDate, direction));
      return;
    }
    if (viewMode === "year") {
      setAnchorDate(shiftYear(anchorDate, direction));
      return;
    }
    if (viewMode === "range") {
      const length = Math.max(1, Math.round((new Date(`${customEnd}T00:00:00Z`) - new Date(`${customStart}T00:00:00Z`)) / DAY) + 1);
      setCustomStart(shiftDate(customStart, length * direction));
      setCustomEnd(shiftDate(customEnd, length * direction));
      return;
    }
    setAnchorDate(shiftDate(anchorDate, 7 * direction));
  };

  const selectViewMode = (mode) => {
    setViewMode(mode);
    if (mode === "range") {
      setCustomStart(period.start);
      setCustomEnd(period.end);
    }
  };

  const selectedEvents = data?.calendarEvents || [];
  const calendarDays = useMemo(() => {
    const startDate = new Date(`${period.start}T00:00:00.000Z`);
    const endDate = new Date(`${period.end}T00:00:00.000Z`);
    const totalDays = Math.max(0, Math.round((endDate - startDate) / DAY) + 1);
    return Array.from({ length: Math.min(366, totalDays) }, (_, index) => {
      const date = shiftDate(period.start, index);
      return {
        date,
        label: dateText(date, { weekday: "short", day: "numeric" }),
        events: selectedEvents.filter((event) => eventFallsOn(event, date)),
      };
    });
  }, [period.start, period.end, selectedEvents]);

  const rangeLabel = periodLabel(viewMode, period.start, period.end);

  return (
    <section className={`scp${compact ? " scp--compact" : ""}`} aria-label="Staff Capacity Planner">
      <style>{`
        .scp-modal-backdrop { position: fixed; inset: 0; background: rgba(8,17,13,.55); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 20px; }
        .scp-modal { background: #fdfbf6; border-radius: 14px; padding: 22px; width: 100%; max-width: 420px; box-shadow: 0 30px 60px -20px rgba(6,18,12,.5); }
        .scp-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .scp-modal-head span { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #6b755f; }
        .scp-modal-head h3 { margin: 4px 0 0; font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 19px; color: #12211a; }
        .scp-modal-head button { background: none; border: none; color: #8a927c; cursor: pointer; padding: 4px; }
        .scp-modal p { font-size: 13px; line-height: 1.55; color: #3a4740; margin: 0 0 14px; }
        .scp-modal-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 700; color: #3a4740; margin-bottom: 12px; }
        .scp-modal-field input, .scp-modal-field select { font-family: inherit; font-weight: 400; font-size: 13.5px; border: 1px solid #cdd8c6; border-radius: 8px; padding: 9px 11px; }
        .scp-modal-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .scp-modal-actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; }
        .scp-modal-delete { display: inline-flex; align-items: center; gap: 6px; background: #fef4f2; color: #a5342a; border: 1px solid rgba(196,69,58,.3); border-radius: 8px; padding: 9px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
        .scp-modal-save { display: inline-flex; align-items: center; gap: 6px; background: #1f5a34; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer; margin-left: auto; }
        .scp-modal-save:disabled { opacity: .6; cursor: not-allowed; }
        .scp-success { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #2c6a34; background: #eef6ea; border: 1px solid rgba(44,106,52,.25); border-radius: 8px; padding: 9px 12px; margin-bottom: 12px; }
      `}</style>
      <header className="scp-head">
        <div>
          <span><Users size={14} /> Delivery planning · live workload view</span>
          <h2>Staff Capacity Planner</h2>
          <p>{mode === "staff" ? "See the team's planned work, approved leave and project deadlines on the calendar below." : "Review allocated activity hours, approved leave, project deadlines and available capacity before creating or reassigning work."}</p>
        </div>
        <div className="scp-controls">
          <label className="scp-view-select">
            <span>Workload period</span>
            <select value={viewMode} onChange={(event) => selectViewMode(event.target.value)} aria-label="Workload period">
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="range">Date range</option>
            </select>
          </label>
          {viewMode === "range" ? (
            <div className="scp-range-fields">
              <label><span>From</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
              <label><span>To</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
            </div>
          ) : viewMode === "month" ? (
            <label className="scp-period-input"><span>Month</span><input type="month" value={anchorDate.slice(0, 7)} onChange={(event) => setAnchorDate(`${event.target.value}-01`)} /></label>
          ) : viewMode === "year" ? (
            <label className="scp-period-input"><span>Year</span><input type="number" min="2000" max="2100" value={anchorDate.slice(0, 4)} onChange={(event) => setAnchorDate(`${event.target.value}-01-01`)} /></label>
          ) : null}
          <div className="scp-period">
            <button type="button" aria-label={`Previous ${viewMode}`} onClick={() => movePeriod(-1)}><ChevronLeft size={16} /></button>
            <strong>{rangeLabel}</strong>
            <button type="button" aria-label={`Next ${viewMode}`} onClick={() => movePeriod(1)}><ChevronRight size={16} /></button>
          </div>
        </div>
      </header>

      {error ? <p className="scp-error"><AlertTriangle size={15} /> {error}</p> : null}
      {loading ? <p className="scp-loading"><Loader2 className="spin" size={16} /> Calculating capacity…</p> : null}
      {!loading && data?.ready === false ? <p className="scp-error"><AlertTriangle size={15} /> {data.message}</p> : null}

      {!loading && data?.ready ? (
        <>
          {mode !== "staff" && (
            <>
              <div className="scp-legend">
                {Object.entries(STATUS).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}
              </div>
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead><tr><th>Staff member</th><th>Capacity</th><th>Contracted hours</th><th>Available hours</th><th>Allocated hours</th><th>Leave</th><th>Projects</th><th>Due</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {data.people.map((person) => {
                      const status = STATUS[person.status] || STATUS.available;
                      const profile = draft[person.id] || { weeklyCapacityHours: person.weeklyCapacityHours, notes: person.notes || "" };
                      return <Fragment key={person.id}>
                        <tr className={person.status === "over_capacity" ? "over" : ""}>
                          <td><strong>{person.name || person.email}</strong><small>{person.email}</small></td>
                          <td><div className="scp-meter"><i style={{ width: `${Math.min(100, person.capacityPercent)}%`, background: status.color }} /><span>{person.capacityPercent}%</span></div></td>
                          <td><strong>{person.weeklyCapacityHours} h</strong><small>per week</small></td>
                          <td>{person.availableHours} h</td><td>{person.allocatedHours} h</td><td>{person.leaveDays ? `${person.leaveDays} day${person.leaveDays === 1 ? "" : "s"}` : "—"}</td><td>{person.activeProjectCount}</td><td>{person.upcomingDueCount}</td>
                          <td><span className="scp-status" style={{ color: status.color, borderColor: `${status.color}66`, background: `${status.color}14` }}>{status.label}</span></td>
                          <td>{data.canEdit ? <button type="button" className="scp-edit" onClick={() => {
                          if (editing === person.id && capacityDirty && !window.confirm("Discard the unsaved capacity change for this person?")) return;
                          setEditing(editing === person.id ? "" : person.id);
                          setDraft({ ...draft, [person.id]: profile });
                        }} title="Edit contracted weekly hours"><Edit3 size={14} /></button> : null}</td>
                        </tr>
                        {editing === person.id ? <tr><td className="scp-profile" colSpan={10}><div className="scp-profile-fields"><label>Contracted weekly hours <input type="number" min="0" max="168" step="0.5" value={profile.weeklyCapacityHours} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, weeklyCapacityHours: event.target.value } })} /></label><label>Capacity notes <input value={profile.notes} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, notes: event.target.value } })} placeholder="Optional availability note" /></label><button type="button" disabled={saving} onClick={() => saveProfile(person)}>{saving ? "Saving…" : "Save contracted hours"}</button></div></td></tr> : null}
                      </Fragment>;
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="scp-calendar-section">
            <div className="scp-calendar-heading"><div><h3><CalendarDays size={16} /> Workload calendar</h3><p>Staff names stay frozen on the left while the selected period scrolls horizontally. Use week, month, year or a custom date range to search planned work.</p></div><span className="scp-calendar-count">{calendarDays.length} day{calendarDays.length === 1 ? "" : "s"}</span></div>
            <div className="scp-calendar-legend">{Object.entries(EVENT).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
            {selectedEvents.length ? (
              <>
              <div className="scp-calendar-scroll" role="region" aria-label="Workload calendar scroll area" tabIndex="0">
                <div className="scp-calendar-grid" role="grid" aria-label={`${rangeLabel} staff workload calendar`} style={{ "--scp-day-count": calendarDays.length }}>
                  <div className="scp-calendar-corner" role="columnheader">Staff member</div>
                  {calendarDays.map((day) => <div className="scp-calendar-day-header" role="columnheader" key={day.date}><strong>{day.label}</strong><small>{day.date.slice(0, 4)}</small></div>)}
                  {data.people.map((person) => <div className="scp-calendar-person-row" role="row" key={`calendar-${person.id}`}>
                    <div className="scp-calendar-staff" role="rowheader" onClick={() => onSelectStaff?.(person)}><strong>{person.name || person.email}</strong><small>{person.weeklyCapacityHours} h/wk</small></div>
                    {calendarDays.map((day) => {
                      const events = day.events.filter((event) => event.staffUserId === person.id);
                      return <div className="scp-calendar-cell" role="gridcell" key={`${person.id}-${day.date}`}>
                        {events.map((event) => { const style = EVENT[event.type] || EVENT.schedule; return <button type="button" className="scp-calendar-event" key={event.id} onClick={() => onSelectStaff?.(person)} title={`${event.title}${event.projectName ? ` · ${event.projectName}` : ""}`}><i style={{ background: style.color }} /><span>{event.title}</span></button>; })}
                      </div>;
                    })}
                  </div>)}
                  {calendarDays.some((day) => day.events.some((event) => !event.staffUserId)) ? <div className="scp-calendar-person-row" role="row" key="calendar-shared">
                    <div className="scp-calendar-staff scp-calendar-staff--shared" role="rowheader"><strong>Shared / unassigned</strong><small>Project-wide items</small></div>
                    {calendarDays.map((day) => <div className="scp-calendar-cell" role="gridcell" key={`shared-${day.date}`}>{day.events.filter((event) => !event.staffUserId).map((event) => {
                      const style = EVENT[event.type] || EVENT.schedule;
                      const manageable = ["activity", "field_survey"].includes(event.type) && event.projectId;
                      return (
                        <button
                          type="button"
                          className="scp-calendar-event"
                          key={event.id}
                          title={manageable ? (mode === "staff" ? `${event.title} — click to request this work` : `${event.title} — double-click to assign, edit or delete`) : event.title}
                          onClick={() => { if (manageable && mode === "staff") openClaimRequest(event); }}
                          onDoubleClick={() => { if (manageable && mode !== "staff") openUnassignedModal(event); }}
                          style={{ cursor: manageable ? "pointer" : "default" }}
                        >
                          <i style={{ background: style.color }} /><span>{event.title}</span>
                        </button>
                      );
                    })}</div>)}
                  </div> : null}
                </div>
              </div>

              {unassignedModal ? (
                <div className="scp-modal-backdrop" role="dialog" aria-label="Manage unassigned activity" onClick={() => !modalBusy && setUnassignedModal(null)}>
                  <div className="scp-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="scp-modal-head">
                      <div>
                        <span>{unassignedModal.projectName}</span>
                        <h3>{unassignedModal.title}</h3>
                      </div>
                      <button type="button" onClick={() => !modalBusy && setUnassignedModal(null)}><X size={16} /></button>
                    </div>
                    {modalError ? <p className="scp-error"><AlertTriangle size={14} /> {modalError}</p> : null}
                    <label className="scp-modal-field">
                      Title
                      <input value={unassignedModal.title} onChange={(event) => setUnassignedModal({ ...unassignedModal, title: event.target.value })} />
                    </label>
                    <div className="scp-modal-row">
                      <label className="scp-modal-field">Start date<input type="date" value={unassignedModal.startDate} onChange={(event) => setUnassignedModal({ ...unassignedModal, startDate: event.target.value })} /></label>
                      <label className="scp-modal-field">Due date<input type="date" value={unassignedModal.dueDate} onChange={(event) => setUnassignedModal({ ...unassignedModal, dueDate: event.target.value })} /></label>
                    </div>
                    <label className="scp-modal-field">
                      Assign to
                      <select value={unassignedModal.staffUserId} onChange={(event) => setUnassignedModal({ ...unassignedModal, staffUserId: event.target.value })}>
                        <option value="">Select a staff member…</option>
                        {(data.people || []).map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
                      </select>
                    </label>
                    <div className="scp-modal-actions">
                      <button type="button" className="scp-modal-delete" disabled={modalBusy} onClick={deleteUnassignedActivity}><Trash2 size={14} /> Delete</button>
                      <button type="button" className="scp-modal-save" disabled={modalBusy} onClick={saveUnassignedAssignment}>
                        {modalBusy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} {modalBusy ? "Saving…" : "Assign & notify"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {claimRequest ? (
                <div className="scp-modal-backdrop" role="dialog" aria-label="Request unassigned work" onClick={() => !claimBusy && setClaimRequest(null)}>
                  <div className="scp-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="scp-modal-head">
                      <div>
                        <span>{claimRequest.projectName}</span>
                        <h3>{claimRequest.title}</h3>
                      </div>
                      <button type="button" onClick={() => !claimBusy && setClaimRequest(null)}><X size={16} /></button>
                    </div>
                    <p>This work isn't assigned to anyone yet. Submit a service request asking to take it on — an administrator will review it.</p>
                    {claimMessage ? <p className={claimMessage.startsWith("Submitted") ? "scp-success" : "scp-error"}>{claimMessage.startsWith("Submitted") ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {claimMessage}</p> : null}
                    <div className="scp-modal-actions">
                      <button type="button" className="scp-modal-save" disabled={claimBusy || claimMessage.startsWith("Submitted")} onClick={submitClaimRequest}>
                        {claimBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {claimBusy ? "Submitting…" : "Submit service request"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              </>
            ) : <p className="scp-empty"><CheckCircle2 size={16} /> No planned workload or approved leave in this period.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
