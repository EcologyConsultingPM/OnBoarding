export const PROJECT_SOURCES_CHANGED = "ec:project-sources-changed";

// Signal freshness only: never store activity records, staff details or drafts.
export function signalProjectSourceChange(url) {
  if (typeof window === "undefined") return;
  const projectId = String(url || "").match(/\/api\/projects\/([^/?]+)/)?.[1] || null;
  const detail = { projectId, changedAt: Date.now() };
  window.dispatchEvent(new CustomEvent(PROJECT_SOURCES_CHANGED, { detail }));
  try {
    window.localStorage.setItem(PROJECT_SOURCES_CHANGED, JSON.stringify({ ...detail, nonce: Math.random().toString(36).slice(2) }));
  } catch {
    // Same-tab refresh still works when browser storage is unavailable.
  }
}
