/**
 * Ecado — data collection.
 *
 * Reads each enabled feed through the SELECT-only client, normalises
 * column names to Ecado's logical field names, and records freshness.
 * Missing tables and missing columns become explicit gaps — never silently
 * skipped, because an absent WHS feed looks identical to a clean WHS
 * record in a brief that omits it.
 *
 * One addition beyond the source kit: this app stores staff references as
 * auth.users uuids (staff_user_id, assigned_to, project_lead_user_id), not
 * the kit's assumed *_email columns. Person-reference fields are resolved
 * to email addresses here, via the ordinary admin client (not the
 * SELECT-only reader — auth.users isn't in the public schema the reader
 * role is granted against, and a staff directory lookup isn't the kind of
 * business-data mutation risk the reader restriction exists to prevent).
 */

import { readerClient } from "./supabase-server";
import { SOURCES, SAFETY_CRITICAL_FEEDS } from "./sources";
import { DEFAULT_THRESHOLDS } from "./thresholds";
import { listDirectoryUsers, directoryById } from "../staffDirectory";

const MAX_ROWS = 5000;

// Logical fields across feeds that hold a person's uuid and need resolving
// to an email string for the rule engine and narration to use directly.
const PERSON_FIELDS = new Set(["manager", "assignedTo", "staffEmail", "owner"]);

function selectList(spec) {
  const columns = [];
  const missing = [];
  for (const [logical, real] of Object.entries(spec.fields)) {
    if (real) columns.push(real);
    else missing.push(logical);
  }
  if (spec.updatedAtColumn) columns.push(spec.updatedAtColumn);
  return { columns: Array.from(new Set(columns)), missing };
}

function normalise(spec, rows) {
  return rows.map((row) => {
    const out = { _raw: row };
    for (const [logical, real] of Object.entries(spec.fields)) {
      out[logical] = real ? row[real] ?? null : null;
    }
    if (spec.updatedAtColumn) out._updatedAt = row[spec.updatedAtColumn] ?? null;
    return out;
  });
}

function resolvePersonFields(rows, emailById) {
  return rows.map((row) => {
    const out = { ...row };
    for (const field of PERSON_FIELDS) {
      if (out[field] && emailById.has(out[field])) out[field] = emailById.get(out[field]);
    }
    return out;
  });
}

function latestTimestamp(rows) {
  let latest = null;
  for (const r of rows) {
    const v = r._updatedAt;
    if (typeof v !== "string") continue;
    const t = new Date(v).getTime();
    if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

async function readFeed(supabase, name, spec, thresholds, emailById) {
  if (!spec.enabled) {
    return {
      feed: name,
      table: spec.table,
      rows: [],
      dataCurrentTo: null,
      gap: {
        reason: "missing_table",
        detail: `Feed "${name}" is not connected. ${SAFETY_CRITICAL_FEEDS.includes(name) ? "This is a safety or compliance feed — its absence is itself a risk." : "Ecado cannot assess the related items."}`,
        requiredFor: spec.requiredFor,
      },
    };
  }

  const { columns, missing } = selectList(spec);
  let query = supabase.from(spec.table).select(columns.join(", ")).limit(MAX_ROWS);
  for (const [col, val] of Object.entries(spec.filter ?? {})) {
    query = query.eq(col, val);
  }

  const { data, error } = await query;
  if (error) {
    return {
      feed: name,
      table: spec.table,
      rows: [],
      dataCurrentTo: null,
      gap: {
        reason: error.code === "42P01" ? "missing_table" : "query_error",
        detail: `Could not read ${spec.table}: ${error.message}`,
        requiredFor: spec.requiredFor,
      },
    };
  }

  let rows = normalise(spec, data ?? []);
  rows = resolvePersonFields(rows, emailById);
  const dataCurrentTo = latestTimestamp(rows);

  let gap;
  if (missing.length) {
    gap = {
      reason: "missing_columns",
      detail: `${spec.table} is missing fields: ${missing.join(", ")}. Rules depending on them are skipped.`,
      requiredFor: spec.requiredFor,
    };
  } else if (dataCurrentTo) {
    const ageHours = (Date.now() - new Date(dataCurrentTo).getTime()) / 3_600_000;
    if (ageHours > thresholds.feed_staleness.warnAfterHours) {
      gap = {
        reason: "stale",
        detail: `${spec.table} has not been updated for ${Math.round(ageHours)} hours. Treat findings from this feed with caution.`,
        requiredFor: spec.requiredFor,
      };
    }
  }

  return { feed: name, table: spec.table, rows, dataCurrentTo, gap };
}

function dateOnly(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function utcDate(value) {
  const text = dateOnly(value);
  return text ? new Date(`${text}T00:00:00.000Z`) : null;
}

function addDays(value, days) {
  const date = utcDate(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(value) {
  const date = utcDate(value) || new Date();
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function calendarDays(start, end) {
  const from = utcDate(start);
  const to = utcDate(end);
  if (!from || !to || from > to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

function overlapDays(start, end, rangeStart, rangeEnd) {
  const from = Math.max(utcDate(start)?.getTime() || Infinity, utcDate(rangeStart)?.getTime() || -Infinity);
  const to = Math.min(utcDate(end)?.getTime() || -Infinity, utcDate(rangeEnd)?.getTime() || Infinity);
  return from <= to ? Math.round((to - from) / 86_400_000) + 1 : 0;
}

// Capacity is a derived, read-only feed. It distributes the planned hours of
// each assigned activity across its start-to-due-date span, then compares each
// week’s share with the staff member’s recorded weekly capacity (38 hours where
// no tailored profile has been saved). This mirrors the workload calendars
// without adding a second source of truth or allowing Ecado to mutate anything.
async function readCapacityFeed(supabase, thresholds, directory, emailById) {
  const [activitiesResult, profilesResult] = await Promise.all([
    supabase.from("project_activities").select("staff_user_id, budget_hours, start_date, due_date, is_active, updated_at").eq("is_active", true).limit(MAX_ROWS),
    supabase.from("staff_capacity_profiles").select("user_id, weekly_capacity_hours, updated_at").limit(MAX_ROWS),
  ]);
  if (activitiesResult.error || profilesResult.error) {
    const error = activitiesResult.error || profilesResult.error;
    return {
      feed: "capacity",
      table: SOURCES.capacity.table,
      rows: [],
      dataCurrentTo: null,
      gap: {
        reason: error?.code === "42P01" ? "missing_table" : "query_error",
        detail: `Could not calculate weekly capacity: ${error?.message || "unknown source error"}`,
        requiredFor: SOURCES.capacity.requiredFor,
      },
    };
  }

  const capacityByUser = new Map((profilesResult.data || []).map((profile) => [profile.user_id, Number(profile.weekly_capacity_hours) || 38]));
  const activeActivities = (activitiesResult.data || []).filter((activity) => activity.staff_user_id && dateOnly(activity.start_date || activity.due_date));
  const staffIds = new Set([...capacityByUser.keys(), ...activeActivities.map((activity) => activity.staff_user_id)]);
  const todayWeek = mondayOf(new Date().toISOString().slice(0, 10));
  const weeks = [todayWeek, addDays(todayWeek, 7), addDays(todayWeek, 14)];
  const buckets = new Map();

  for (const staffId of staffIds) {
    for (const weekStarting of weeks) {
      const email = emailById.get(staffId) || staffId;
      const key = `${staffId}::${weekStarting}`;
      buckets.set(key, {
        staffEmail: email,
        weekStarting,
        allocatedHours: 0,
        capacityHours: capacityByUser.get(staffId) || 38,
        _updatedAt: null,
      });
    }
  }

  for (const activity of activeActivities) {
    const start = dateOnly(activity.start_date || activity.due_date);
    const due = dateOnly(activity.due_date || activity.start_date);
    if (!start || !due) continue;
    const from = start <= due ? start : due;
    const to = start <= due ? due : start;
    const totalDays = calendarDays(from, to) || 1;
    const plannedHours = Number(activity.budget_hours) || 0;
    for (const weekStarting of weeks) {
      const key = `${activity.staff_user_id}::${weekStarting}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const days = overlapDays(from, to, weekStarting, addDays(weekStarting, 6));
      if (!days) continue;
      bucket.allocatedHours += plannedHours * (days / totalDays);
      if (activity.updated_at && (!bucket._updatedAt || new Date(activity.updated_at) > new Date(bucket._updatedAt))) bucket._updatedAt = activity.updated_at;
    }
  }

  const rows = [...buckets.values()].map((row) => ({
    ...row,
    allocatedHours: Math.round(row.allocatedHours * 100) / 100,
  }));
  const profileUpdated = (profilesResult.data || []).map((profile) => profile.updated_at).filter(Boolean);
  const dataCurrentTo = latestTimestamp([...rows, ...profileUpdated.map((updatedAt) => ({ _updatedAt: updatedAt }))]);
  let gap;
  if (dataCurrentTo) {
    const ageHours = (Date.now() - new Date(dataCurrentTo).getTime()) / 3_600_000;
    if (ageHours > thresholds.feed_staleness.warnAfterHours) {
      gap = {
        reason: "stale",
        detail: `${SOURCES.capacity.table} has not been updated for ${Math.round(ageHours)} hours. Treat capacity findings with caution.`,
        requiredFor: SOURCES.capacity.requiredFor,
      };
    }
  }
  return { feed: "capacity", table: SOURCES.capacity.table, rows, dataCurrentTo, gap };
}

export async function collectSnapshot(adminClient, thresholds = DEFAULT_THRESHOLDS, only = null) {
  const supabase = readerClient();
  const names = only ?? Object.keys(SOURCES);

  const directory = await listDirectoryUsers(adminClient, {});
  const byId = directoryById(directory);
  const emailById = new Map([...byId.entries()].map(([id, record]) => [id, record.email]));

  const results = await Promise.all(names.map((name) =>
    SOURCES[name]?.derived
      ? readCapacityFeed(supabase, thresholds, directory, emailById)
      : readFeed(supabase, name, SOURCES[name], thresholds, emailById),
  ));

  const feeds = {};
  const gaps = [];
  const dataCurrentTo = {};
  for (const r of results) {
    feeds[r.feed] = r;
    dataCurrentTo[r.feed] = r.dataCurrentTo;
    if (r.gap) gaps.push(r.gap);
  }

  return { generatedAt: new Date().toISOString(), feeds, gaps, dataCurrentTo };
}

/** Convenience accessor used by the rule engine. Returns [] for absent feeds. */
export function rowsOf(snapshot, feed) {
  return snapshot.feeds[feed]?.rows ?? [];
}

export function feedAvailable(snapshot, feed) {
  const f = snapshot.feeds[feed];
  return !!f && !!f.rows && (!f.gap || f.gap.reason === "stale");
}

export function sourcesRead(snapshot) {
  return Object.values(snapshot.feeds)
    .filter((f) => !f.gap || f.gap.reason === "stale")
    .map((f) => f.table);
}
