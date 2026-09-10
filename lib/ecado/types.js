/**
 * Ecado — shared constants and helpers.
 *
 * A Finding is the atomic unit of everything Ecado produces. Every finding
 * carries the three mandatory lines (what happened / why it matters / what
 * next) and a source reference, so no statement in a brief is
 * unattributable. (TypeScript interfaces from the source kit are dropped —
 * this file keeps only what exists at runtime.)
 */

/** Fixed priority order. Index 0 outranks everything below it. */
export const PRIORITY_ORDER = ["safety", "compliance", "client", "delivery", "wellbeing", "capacity", "quality", "commercial", "improvement"];

export const RATING_ICON = { critical: "\ud83d\udd34", high: "\ud83d\udfe0", medium: "\ud83d\udfe1", low: "\ud83d\udfe2" };

export const RATING_WEIGHT = { critical: 0, high: 1, medium: 2, low: 3 };

export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const r = RATING_WEIGHT[a.rating] - RATING_WEIGHT[b.rating];
    if (r !== 0) return r;
    const d = PRIORITY_ORDER.indexOf(a.domain) - PRIORITY_ORDER.indexOf(b.domain);
    if (d !== 0) return d;
    return (b.dueInDays ?? -9999) - (a.dueInDays ?? -9999);
  });
}

export function countByRating(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.rating] += 1;
  return counts;
}
