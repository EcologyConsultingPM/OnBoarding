// Merge admin overrides onto the static species baseline.
// Baseline profiles are read-only (lib/floraData.js / lib/faunaData.js).
// An override (from the species_overrides table) can change editable fields,
// hide specific photo attributions, and carry a locked/published flag.
// Override always wins; nothing in the baseline is mutated.

const EDITABLE = ["name", "common", "listing", "family", "form", "habitat", "diag", "jur"];

export function mergeOverrides(profiles, overrides) {
  if (!overrides || !overrides.length) return profiles;
  const byName = new Map(overrides.map((o) => [o.taxon_name, o]));
  return profiles.map((p) => {
    const o = byName.get(p.name);
    if (!o) return p;
    const merged = { ...p };
    // Apply whitelisted field edits.
    if (o.fields && typeof o.fields === "object") {
      for (const k of EDITABLE) {
        if (o.fields[k] !== undefined && o.fields[k] !== null && o.fields[k] !== "") merged[k] = o.fields[k];
      }
    }
    // Remove hidden photo attributions.
    if (Array.isArray(o.hidden_photos) && o.hidden_photos.length && Array.isArray(merged.atts)) {
      const hidden = new Set(o.hidden_photos.map(Number));
      merged.atts = merged.atts.filter((a) => !hidden.has(Number(a.n)));
    }
    // Carry admin-state flags for the UI.
    merged._locked = o.locked === true;
    merged._edited = true;
    return merged;
  });
}
