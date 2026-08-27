import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ClipboardList, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const ACTIVE_TASK_STATES = new Set(["accepted", "in_progress", "submitted", "revising"]);
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatTaskDate(value) {
  const date = parseLocalDate(value);
  return date ? date.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "No due date";
}

// Displays deadlines from the protected Remote Tasks API. Only tasks accepted by
// the current staff member (or already in progress/review) are included.
export default function StaffPortalTaskCalendar() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const today = useMemo(() => new Date(), []);

  const load = useCallback(async (showSpinner = false) => {
    if (!session?.access_token) return;
    if (showSpinner) setRefreshing(true);
    try {
      const response = await fetch("/api/remote-tasks", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load tasks.");
      setTasks((data.tasks || []).filter((task) => ACTIVE_TASK_STATES.has(task.status) && task.due_date));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    load();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => document.removeEventListener("visibilitychange", refreshOnVisible);
  }, [load]);

  const byDate = useMemo(() => {
    const index = new Map();
    tasks.forEach((task) => {
      const current = index.get(task.due_date) || [];
      current.push(task);
      index.set(task.due_date, current);
    });
    return index;
  }, [tasks]);

  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: startDay + daysInMonth }, (_, index) => {
    const day = index - startDay + 1;
    return day > 0 ? day : null;
  });
  const acceptedDueDates = tasks
    .filter((task) => parseLocalDate(task.due_date)?.getTime() >= new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime())
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 3);

  return (
    <section className="staff-task-calendar" aria-label="Task calendar">
      <div className="staff-task-calendar-head">
        <div>
          <h2>{MONTHS[month]} {year}</h2>
          <p><CalendarDays size={12} /> Accepted task deadlines</p>
        </div>
        <button type="button" className="staff-task-calendar-refresh" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh task calendar">
          <RefreshCw size={13} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      <div className="staff-task-calendar-grid" aria-label={`${MONTHS[month]} ${year}`}>
        {WEEKDAYS.map((day, index) => <div className="staff-task-calendar-weekday" key={`${day}-${index}`}>{day}</div>)}
        {cells.map((day, index) => {
          if (!day) return <div className="staff-task-calendar-empty" key={`empty-${index}`} aria-hidden="true" />;
          const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayTasks = byDate.get(dateKey) || [];
          const isToday = day === today.getDate();
          const label = dayTasks.length ? `${day}: ${dayTasks.length} accepted task deadline${dayTasks.length === 1 ? "" : "s"}` : String(day);
          return (
            <div key={dateKey} className={`staff-task-calendar-day${isToday ? " is-today" : ""}${dayTasks.length ? " has-task" : ""}`} title={dayTasks.map((task) => `${task.project}: ${task.task}`).join(" · ")} aria-label={label}>
              <span>{day}</span>
              {dayTasks.length ? <i aria-hidden="true">{dayTasks.length > 1 ? dayTasks.length : ""}</i> : null}
            </div>
          );
        })}
      </div>

      {loading ? <p className="staff-task-calendar-empty-message">Loading accepted task deadlines…</p> : null}
      {!loading && error ? <p className="staff-task-calendar-empty-message">Your task calendar could not load. Refresh to try again.</p> : null}
      {!loading && !error && acceptedDueDates.length === 0 ? <p className="staff-task-calendar-empty-message">Accept a task brief and its due date will appear here automatically.</p> : null}
      {!loading && !error && acceptedDueDates.length > 0 ? (
        <div className="staff-task-calendar-list">
          {acceptedDueDates.map((task) => (
            <a key={task.id} href="/staff/remote-operations" className="staff-task-calendar-item">
              <ClipboardList size={13} />
              <span><strong>{formatTaskDate(task.due_date)}</strong> · {task.project}: {task.task}</span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
