"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Edit3, Loader2, Users } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

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

export default function StaffCapacityPlanner({ compact = false, onSelectStaff = null }) {
  const { session } = useAuth();
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
  const [saving, setSaving] = useState(false);

  const period = useMemo(
    () => periodFor(viewMode, anchorDate, customStart, customEnd),
    [viewMode, anchorDate, customStart, customEnd],
  );

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/staff-capacity?start=${period.start}&end=${period.end}`, {
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
  }, [session?.access_token, period.start, period.end]);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async (person) => {
    const candidate = draft[person.id] || { weeklyCapacityHours: person.weeklyCapacityHours, notes: person.notes || "" };
    setSaving(true);
    try {
      const response = await fetch("/api/admin/staff-capacity", {
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
      <header className="scp-head">
        <div>
          <span><Users size={14} /> Delivery planning · live workload view</span>
          <h2>Staff Capacity Planner</h2>
          <p>Review allocated activity hours, approved leave, project deadlines and available capacity before creating or reassigning work.</p>
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
                      <td>{data.canEdit ? <button type="button" className="scp-edit" onClick={() => { setEditing(editing === person.id ? "" : person.id); setDraft({ ...draft, [person.id]: profile }); }} title="Edit contracted weekly hours"><Edit3 size={14} /></button> : null}</td>
                    </tr>
                    {editing === person.id ? <tr><td className="scp-profile" colSpan={10}><div className="scp-profile-fields"><label>Contracted weekly hours <input type="number" min="0" max="168" step="0.5" value={profile.weeklyCapacityHours} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, weeklyCapacityHours: event.target.value } })} /></label><label>Capacity notes <input value={profile.notes} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, notes: event.target.value } })} placeholder="Optional availability note" /></label><button type="button" disabled={saving} onClick={() => saveProfile(person)}>{saving ? "Saving…" : "Save contracted hours"}</button></div></td></tr> : null}
                  </Fragment>;
                })}
              </tbody>
            </table>
          </div>

          <div className="scp-calendar-section">
            <div className="scp-calendar-heading"><div><h3><CalendarDays size={16} /> Workload calendar</h3><p>Staff names stay frozen on the left while the selected period scrolls horizontally. Use week, month, year or a custom date range to search planned work.</p></div><span className="scp-calendar-count">{calendarDays.length} day{calendarDays.length === 1 ? "" : "s"}</span></div>
            <div className="scp-calendar-legend">{Object.entries(EVENT).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
            {selectedEvents.length ? (
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
                    {calendarDays.map((day) => <div className="scp-calendar-cell" role="gridcell" key={`shared-${day.date}`}>{day.events.filter((event) => !event.staffUserId).map((event) => { const style = EVENT[event.type] || EVENT.schedule; return <button type="button" className="scp-calendar-event" key={event.id} title={event.title}><i style={{ background: style.color }} /><span>{event.title}</span></button>; })}</div>)}
                  </div> : null}
                </div>
              </div>
            ) : <p className="scp-empty"><CheckCircle2 size={16} /> No planned workload or approved leave in this period.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
