/**
 * Storage abstraction for the onboarding workbook.
 *
 * Today this reads/writes the browser's localStorage, so the app works
 * standalone with no backend. Every value is stored per-browser, per-device.
 *
 * When you're ready for multi-user sync (e.g. new hires and admins sharing
 * one workbook), swap the body of these three functions for calls to a
 * Supabase table (or an API route that wraps one) — the call sites in
 * components/OnboardingWorkbook.js don't need to change, since the
 * function signatures (async get/set/remove, returning { value }) stay
 * the same either way.
 */

const PREFIX = "ecology-onboarding:";

export async function getItem(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return null;
    return { key, value: raw };
  } catch (e) {
    console.error("storage.getItem failed", e);
    return null;
  }
}

export async function setItem(key, value) {
  if (typeof window === "undefined") return null;
  try {
    window.localStorage.setItem(PREFIX + key, value);
    return { key, value };
  } catch (e) {
    console.error("storage.setItem failed", e);
    return null;
  }
}

export async function removeItem(key) {
  if (typeof window === "undefined") return null;
  try {
    window.localStorage.removeItem(PREFIX + key);
    return { key, deleted: true };
  } catch (e) {
    console.error("storage.removeItem failed", e);
    return null;
  }
}
