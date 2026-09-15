/**
 * Ecado — threshold configuration.
 *
 * Ratings are rule-based, not subjective. These defaults mirror the
 * approved threshold table in the build specification. DB values in
 * ecado_thresholds override them, and every change is written to
 * ecado_threshold_history by trigger.
 */

export const DEFAULT_THRESHOLDS = {
  deliverable: { highDueWithinDays: 5, mediumDueWithinDays: 15, highIncompletePct: 80 },
  corrective_action: { criticalOverdueDays: 14, highOverdueDays: 1 },
  certification: { highExpiringDays: 14, mediumExpiringDays: 60 },
  allocation: { criticalPct: 120, highPct: 105, mediumPct: 95, underPct: 80 },
  budget: { criticalOverrunPct: 15, highOverrunPct: 8 },
  variation: { highUnapprovedDays: 5 },
  quote: { mediumDecisionWithinDays: 10 },
  survey_window: { highClosingWithinDays: 7 },
  feed_staleness: { warnAfterHours: 36 },
};

export async function loadThresholds(supabase) {
  const { data, error } = await supabase.from("ecado_thresholds").select("key, value");
  if (error || !data) return structuredClone(DEFAULT_THRESHOLDS);

  const merged = structuredClone(DEFAULT_THRESHOLDS);
  for (const row of data) {
    if (row.key in merged) Object.assign(merged[row.key], row.value);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Date helpers — all Ecado date maths runs through here so that       */
/* "overdue by 3 days" means the same thing in every rule.             */
/* ------------------------------------------------------------------ */

export const MS_PER_DAY = 86_400_000;

/** Whole days from `now` until `date`. Negative = in the past (overdue). */
export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / MS_PER_DAY);
}

/** Whole days a due date is overdue. 0 or negative means not yet overdue. */
export function daysOverdue(date, now = new Date()) {
  const d = daysUntil(date, now);
  return d === null ? 0 : Math.max(0, -d);
}

/** Working days between now and a date, excluding weekends. Public holidays not modelled. */
export function workingDaysUntil(date, now = new Date()) {
  const total = daysUntil(date, now);
  if (total === null) return null;
  const sign = total < 0 ? -1 : 1;
  let remaining = Math.abs(total);
  let count = 0;
  const cursor = new Date(now);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + sign);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    remaining -= 1;
  }
  return count * sign;
}

export function formatAuDate(date) {
  if (!date) return "unknown date";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "unknown date";
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}
