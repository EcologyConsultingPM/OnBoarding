import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ClipboardList, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/AuthProvider";

const ACTIVE_TASK_STATES = new Set([
  "accepted",
  "in_progress",
  "submitted",
  "revising",
]);
const CALENDAR_ACTIVITY_STATES = new Set([
  "not_commenced",
  "active",
  "need_info",
  "paused_other",
  "qa_review",
]);
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatTaskDate(value) {
  const date = parseLocalDate(value);
  return date
    ? date.toLocaleDateString("en-AU", { day: "numeric", month: "short" })
    : "No due date";
}

// Displays accepted remote-task deadlines and dated staff project activities.
// Sourced from the same /api/staff/capacity endpoint the Staff Capacity
// Planner uses (filtered to this person's own events) so this home-page
// widget can never show different information to the full team calendar —
// previously this fetched /api/remote-tasks + /api/my-activities directly,
// a separate query path that could (and did) drift out of sync.
export default function StaffPortalTaskCalendar() {
  const { session } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const today = useMemo(() => new Date(), []);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!session?.access_token || !session?.user?.id) return;
      if (showSpinner) setRefreshing(true);
      try {
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const year = today.getFullYear();
        const month = today.getMonth();
        const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
        const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
        const response = await fetch(`/api/staff/capacity?start=${start}&end=${end}`, { headers });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load your work calendar.");

        const ownEvents = (data.calendarEvents || []).filter(
          (event) => event.staffUserId === session.user.id && event.type !== "leave",
        );
        const mapped = ownEvents.map((event) => ({
          id: event.id,
          type: event.type === "task_brief" ? "remote" : "activity",
          dueDate: event.endDate || event.startDate,
          project: event.projectName || "",
          title: event.title,
          href: event.type === "task_brief" ? "/staff/notifications" : "/staff/projects",
        }));

        setEntries(mapped);
        setError(false);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, today],
  );

  useEffect(() => {
    load();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshOnVisible);
  }, [load]);

  const byDate = useMemo(() => {
    const index = new Map();
    entries.forEach((entry) => {
      const current = index.get(entry.dueDate) || [];
      current.push(entry);
      index.set(entry.dueDate, current);
    });
    return index;
  }, [entries]);

  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: startDay + daysInMonth }, (_, index) => {
    const day = index - startDay + 1;
    return day > 0 ? day : null;
  });
  const upcomingEntries = entries
    .filter(
      (entry) =>
        parseLocalDate(entry.dueDate)?.getTime() >=
        new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        ).getTime(),
    )
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .slice(0, 4);

  return (
    <section className="staff-task-calendar" aria-label="Work calendar">
      <div className="staff-task-calendar-head">
        <div>
          <h2>
            {MONTHS[month]} {year}
          </h2>
          <p>
            <CalendarDays size={12} /> Work deadlines
          </p>
        </div>
        <button
          type="button"
          className="staff-task-calendar-refresh"
          onClick={() => load(true)}
          disabled={refreshing}
          aria-label="Refresh work calendar"
        >
          <RefreshCw size={13} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      <div
        className="staff-task-calendar-grid"
        aria-label={`${MONTHS[month]} ${year}`}
      >
        {WEEKDAYS.map((day, index) => (
          <div className="staff-task-calendar-weekday" key={`${day}-${index}`}>
            {day}
          </div>
        ))}
        {cells.map((day, index) => {
          if (!day)
            return (
              <div
                className="staff-task-calendar-empty"
                key={`empty-${index}`}
                aria-hidden="true"
              />
            );
          const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEntries = byDate.get(dateKey) || [];
          const isToday = day === today.getDate();
          const label = dayEntries.length
            ? `${day}: ${dayEntries.length} work deadline${dayEntries.length === 1 ? "" : "s"}`
            : String(day);
          return (
            <div
              key={dateKey}
              className={`staff-task-calendar-day${isToday ? " is-today" : ""}${dayEntries.length ? " has-task" : ""}`}
              title={dayEntries
                .map((entry) => `${entry.project}: ${entry.title}`)
                .join(" · ")}
              aria-label={label}
            >
              <span>{day}</span>
              {dayEntries.length ? (
                <i aria-hidden="true">
                  {dayEntries.length > 1 ? dayEntries.length : ""}
                </i>
              ) : null}
            </div>
          );
        })}
      </div>

      {loading ? (
        <p className="staff-task-calendar-empty-message">
          Loading work deadlines…
        </p>
      ) : null}
      {!loading && error ? (
        <p className="staff-task-calendar-empty-message">
          Your work calendar could not load. Refresh to try again.
        </p>
      ) : null}
      {!loading && !error && upcomingEntries.length === 0 ? (
        <p className="staff-task-calendar-empty-message">
          Accept a task brief, or receive a dated project activity, and its
          deadline will appear here automatically.
        </p>
      ) : null}
      {!loading && !error && upcomingEntries.length > 0 ? (
        <div className="staff-task-calendar-list">
          {upcomingEntries.map((entry) => (
            <a
              key={entry.id}
              href={entry.href}
              className={`staff-task-calendar-item ${entry.type}`}
            >
              <ClipboardList size={13} />
              <span>
                <strong>{formatTaskDate(entry.dueDate)}</strong> ·{" "}
                {entry.project}: {entry.title}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
