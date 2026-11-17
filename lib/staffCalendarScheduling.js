// Date-only scheduling shared by the capacity producer and calendar UI. This
// changes occurrences/effort only: saved source dates are never moved or edited.
const DAY = 24 * 60 * 60 * 1000;

function asDate(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? parsed : null;
}

function spanDates(start, end) {
  const from = asDate(start || end);
  const to = asDate(end || start);
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

function isWorkingDay(date) {
  return date.getUTCDay() !== 0 && date.getUTCDay() !== 6;
}

// Strict UTC date-only validation: invalid dates and timestamps must not shade
// or block a calendar day just because JavaScript normalises their input.
export function isNonWorkingDay(dateOnly) {
  if (typeof dateOnly !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;
  const date = asDate(dateOnly);
  return Boolean(date && !isWorkingDay(date));
}

// Normal work is Monday–Friday, even for a saved weekend-only source span.
// Only explicitly opted-in manual task briefs can book a Saturday, Sunday,
// or the two-day weekend. Never infer weekend work from a broad source span.
export function calendarDayPolicy(start, end, allowManualWeekend = false) {
  if (allowManualWeekend !== true) return "working_days";
  const span = spanDates(start, end);
  if (!span || span.to.getTime() - span.from.getTime() > DAY) return "working_days";
  for (let cursor = span.from; cursor <= span.to; cursor = new Date(cursor.getTime() + DAY)) {
    if (isWorkingDay(cursor)) return "working_days";
  }
  return "calendar_days";
}

function countDays(span, rangeStart, rangeEnd, policy) {
  const range = spanDates(rangeStart, rangeEnd);
  if (!span || !range) return 0;
  const from = new Date(Math.max(span.from.getTime(), range.from.getTime()));
  const to = new Date(Math.min(span.to.getTime(), range.to.getTime()));
  let days = 0;
  for (let cursor = from; cursor <= to; cursor = new Date(cursor.getTime() + DAY)) {
    if (policy === "calendar_days" || isWorkingDay(cursor)) days += 1;
  }
  return days;
}

// Numeric occurrence count. Use the source's FULL span to choose the policy,
// even when the visible range overlaps only Saturday/Sunday. Both numerator
// and denominator of capacity proration must call this same function.
export function scheduledDaysInRange(start, end, rangeStart, rangeEnd, allowManualWeekend = false) {
  return countDays(spanDates(start, end), rangeStart, rangeEnd, calendarDayPolicy(start, end, allowManualWeekend));
}

export function eventFallsOnWorkDay(event, date) {
  if (!event || !asDate(date)) return false;
  const start = event.date || event.startDate || event.start_date || event.endDate || event.end_date || event.dueDate || event.due_date;
  const end = event.endDate || event.end_date || event.dueDate || event.due_date || start;
  const span = spanDates(start, end);
  if (!span) return false;
  // Dates-only obligations are not automatic weekend bookings. Ignore a stale
  // calendar_days payload on every non-manual source; task briefs can infer
  // an explicit weekend-only booking unless either policy alias forbids it.
  const allowManualWeekend = event.type === "task_brief"
    && event.dayPolicy !== "working_days" && event.day_policy !== "working_days";
  return countDays(span, date, date, calendarDayPolicy(start, end, allowManualWeekend)) > 0;
}
