"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Edit3, Loader2, Users } from "lucide-react";
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

function dateText(value) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function localDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function shiftDate(value, count) {
  const d = new Date(`${value}T00:00:00`);
  d.setDate(d.getDate() + count);
  return localDate(d);
}

function weekStart(value) {
  const date = new Date(`${value}T00:00:00`);
  const offset = (date.getDay() + 6) % 7; // Monday is the start of the delivery week.
  date.setDate(date.getDate() - offset);
  return localDate(date);
}

function weekdayLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function eventFallsOn(event, date) {
  const start = String(event.date || event.startDate || "").slice(0, 10);
  const end = String(event.endDate || start).slice(0, 10);
  return start && start <= date && end >= date;
}

export default function StaffCapacityPlanner({ compact = false, onSelectStaff = null }) {
  const { session } = useAuth();
  const [start, setStart] = useState(() => weekStart(localDate()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const end = useMemo(() => shiftDate(start, 6), [start]);
  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/staff-capacity?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load staff capacity.");
      setData(payload);
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Could not load staff capacity.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, start, end]);

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
      if (!response.ok) throw new Error(payload.error || "Could not save capacity settings.");
      setEditing("");
      await load();
    } catch (requestError) {
      setError(requestError.message || "Could not save capacity settings.");
    } finally {
      setSaving(false);
    }
  };

  const moveRange = (direction) => setStart(shiftDate(start, 7 * direction));
  const selectedEvents = data?.calendarEvents || [];
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, label: weekdayLabel(date), events: selectedEvents.filter((event) => eventFallsOn(event, date)) };
  }), [start, selectedEvents]);

  return (
    <section className={`scp${compact ? " scp--compact" : ""}`} aria-label="Staff Capacity Planner">
      <header className="scp-head">
        <div>
          <span><Users size={14} /> Delivery planning · live workload view</span>
          <h2>Staff Capacity Planner</h2>
          <p>Review allocated activity hours, approved leave, project deadlines and available capacity before creating or reassigning work.</p>
        </div>
          <div className="scp-controls">
            <div className="scp-period">
              <button type="button" aria-label="Previous week" onClick={() => moveRange(-1)}><ChevronLeft size={16} /></button>
              <strong>Week of {dateText(start)} – {dateText(end)}</strong>
              <button type="button" aria-label="Next week" onClick={() => moveRange(1)}><ChevronRight size={16} /></button>
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
              <thead><tr><th>Staff member</th><th>Capacity</th><th>Available hours</th><th>Allocated hours</th><th>Leave</th><th>Projects</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.people.map((person) => {
                  const status = STATUS[person.status] || STATUS.available;
                  const profile = draft[person.id] || { weeklyCapacityHours: person.weeklyCapacityHours, notes: person.notes || "" };
                  return <tr key={person.id} className={person.status === "over_capacity" ? "over" : ""}>
                    <td><strong>{person.name || person.email}</strong><small>{person.email}</small></td>
                    <td><div className="scp-meter"><i style={{ width: `${Math.min(100, person.capacityPercent)}%`, background: status.color }} /><span>{person.capacityPercent}%</span></div></td>
                    <td>{person.availableHours} h</td><td>{person.allocatedHours} h</td><td>{person.leaveDays ? `${person.leaveDays} day${person.leaveDays === 1 ? "" : "s"}` : "—"}</td><td>{person.activeProjectCount}</td><td>{person.upcomingDueCount}</td>
                    <td><span className="scp-status" style={{ color: status.color, borderColor: `${status.color}66`, background: `${status.color}14` }}>{status.label}</span></td>
                    <td>{data.canEdit ? <button type="button" className="scp-edit" onClick={() => { setEditing(editing === person.id ? "" : person.id); setDraft({ ...draft, [person.id]: profile }); }} title="Edit weekly capacity"><Edit3 size={14} /></button> : null}</td>
                    {editing === person.id ? <td className="scp-profile" colSpan={9}><label>Weekly capacity <input type="number" min="0" max="168" step="0.5" value={profile.weeklyCapacityHours} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, weeklyCapacityHours: event.target.value } })} /></label><label>Capacity notes <input value={profile.notes} onChange={(event) => setDraft({ ...draft, [person.id]: { ...profile, notes: event.target.value } })} placeholder="Optional availability note" /></label><button type="button" disabled={saving} onClick={() => saveProfile(person)}>{saving ? "Saving…" : "Save capacity"}</button></td> : null}
                  </tr>;
                })}
              </tbody>
            </table>
          </div>

          <div className="scp-calendar-section">
            <div><h3><CalendarDays size={16} /> Workload calendar</h3><p>Activities, approved leave and delivery milestones in the selected period.</p></div>
            <div className="scp-calendar-legend">{Object.entries(EVENT).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
            {selectedEvents.length ? <div className="scp-week-grid" role="grid" aria-label="Weekly workload calendar">{weekDays.map((day) => (
              <section className="scp-week-day" key={day.date} role="gridcell">
                <header><strong>{day.label}</strong><span>{day.events.length} item{day.events.length === 1 ? "" : "s"}</span></header>
                <div className="scp-week-events">
                  {day.events.length ? day.events.map((event) => {
                    const style = EVENT[event.type] || EVENT.schedule;
                    const person = event.staffUserId ? data.people.find((candidate) => candidate.id === event.staffUserId) : null;
                    return <button type="button" key={`${event.id}-${day.date}`} className="scp-event" onClick={() => person && onSelectStaff?.(person)}><i style={{ background: style.color }} /><div><strong>{event.title}</strong><span>{event.projectName || "Project scheduling"}{person ? ` · ${person.name || person.email}` : ""}</span></div></button>;
                  }) : <p className="scp-week-empty">No planned work</p>}
                </div>
              </section>
            ))}</div> : <p className="scp-empty"><CheckCircle2 size={16} /> No planned workload or approved leave this week.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}
