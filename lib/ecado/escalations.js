/**
 * Ecado — escalation persistence.
 *
 * Escalations do not expire. A finding that stops appearing in the data is
 * NOT closed automatically: it stays open, flagged "no longer detected",
 * until a human records a closure reason. Auto-closing on disappearance is
 * how critical items quietly vanish when someone edits a due date.
 */

import { writerClient, assertWritable } from "./supabase-server";
import { RATING_WEIGHT } from "./types";

const TABLE = "ecado_escalations";

/** Only level 3 and 4 findings persist. Levels 1–2 live in the brief only. */
export function shouldPersist(f) {
  return f.level >= 3;
}

export async function persistEscalations(findings) {
  assertWritable(TABLE);
  const supabase = writerClient();
  const persistable = findings.filter(shouldPersist);
  if (!persistable.length) return { opened: 0, updated: 0 };

  const fingerprints = persistable.map((f) => f.fingerprint);
  const { data: existing } = await supabase.from(TABLE).select("id, fingerprint, peak_rating, closed_at").in("fingerprint", fingerprints);
  const byFingerprint = new Map((existing ?? []).map((e) => [e.fingerprint, e]));

  const now = new Date().toISOString();
  let opened = 0;
  let updated = 0;

  for (const f of persistable) {
    const prior = byFingerprint.get(f.fingerprint);

    // A previously closed item that recurs is a NEW escalation with a new
    // fingerprint suffix, so recurrence is visible rather than hidden
    // inside the old record.
    if (prior?.closed_at) {
      await supabase.from(TABLE).insert({
        fingerprint: `${f.fingerprint}:r${Date.parse(now)}`,
        rule_id: f.ruleId,
        source_type: f.sourceType,
        source_id: f.sourceId,
        source_ref: f.sourceRef ?? null,
        level: f.level,
        rating: f.rating,
        peak_rating: f.rating,
        title: `${f.title} (recurrence)`,
        what_happened: `${f.whatHappened} This item was previously closed and has recurred.`,
        why_it_matters: `${f.whyItMatters} Recurrence indicates the earlier corrective action did not hold.`,
        what_next: f.whatNext,
        owner: f.owner ?? null,
        detail: f.detail ?? {},
      });
      opened += 1;
      continue;
    }

    if (prior) {
      const peak = RATING_WEIGHT[f.rating] < RATING_WEIGHT[prior.peak_rating] ? f.rating : prior.peak_rating;
      await supabase.from(TABLE).update({
        rating: f.rating,
        level: f.level,
        peak_rating: peak,
        last_seen_at: now,
        what_happened: f.whatHappened,
        what_next: f.whatNext,
        owner: f.owner ?? null,
        detail: f.detail ?? {},
      }).eq("id", prior.id);
      updated += 1;
    } else {
      await supabase.from(TABLE).insert({
        fingerprint: f.fingerprint,
        rule_id: f.ruleId,
        source_type: f.sourceType,
        source_id: f.sourceId,
        source_ref: f.sourceRef ?? null,
        level: f.level,
        rating: f.rating,
        peak_rating: f.rating,
        title: f.title,
        what_happened: f.whatHappened,
        why_it_matters: f.whyItMatters,
        what_next: f.whatNext,
        owner: f.owner ?? null,
        detail: f.detail ?? {},
      });
      opened += 1;
    }
  }

  return { opened, updated };
}

/**
 * Open escalations that the current data no longer produces. Surfaced
 * separately in the brief — the most likely place for a problem to be
 * hidden by a record edit rather than resolved.
 */
export async function staleOpenEscalations(currentFingerprints) {
  const supabase = writerClient();
  const { data } = await supabase.from(TABLE).select("*").is("closed_at", null).order("opened_at", { ascending: true });
  const current = new Set(currentFingerprints);
  return (data ?? []).filter((e) => !current.has(e.fingerprint) && !current.has(e.fingerprint.split(":r")[0]));
}

export async function openEscalations() {
  const supabase = writerClient();
  const { data } = await supabase.from(TABLE).select("*").is("closed_at", null).order("level", { ascending: false }).order("opened_at", { ascending: true });
  return data ?? [];
}

export async function closeEscalation(id, closedBy, reason) {
  if (!reason || reason.trim().length < 10) {
    return { ok: false, error: "A closure reason of at least 10 characters is required." };
  }
  assertWritable(TABLE);
  const { error } = await writerClient().from(TABLE).update({
    closed_at: new Date().toISOString(),
    closed_by: closedBy,
    closure_reason: reason.trim(),
  }).eq("id", id).is("closed_at", null);

  return error ? { ok: false, error: error.message } : { ok: true };
}
