"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Per-user local draft retention for a form.
 *
 * The pattern was already implemented three times — Service Requests, the
 * Core Training quiz runner, and (added recently) the new project form — each
 * with its own debounce, its own emptiness test and its own restore logic.
 * This is that pattern extracted once so the remaining forms get it without a
 * fourth copy.
 *
 * Deliberately localStorage rather than a server draft: a half-written form is
 * not a business record, and persisting partial rows server-side creates
 * exactly the orphaned-state problems this codebase has already had to clean
 * up. Drafts stay on the device that typed them.
 *
 *   const { value, setValue, restored, discard } =
 *     useFormDraft(`ec-quote-draft:${userId}`, BLANK, { ignore: ["status"] });
 *
 * @param {string}  key      Storage key. Pass "" to disable (e.g. no user yet).
 * @param {object}  blank    The empty form, used for reset and emptiness tests.
 * @param {object}  options
 * @param {string[]} options.ignore  Fields that do not count as "user typed
 *                                   something" — selects with defaults, etc.
 * @param {number}   options.delay   Debounce in ms. Default 450, matching the
 *                                   existing Service Requests implementation.
 */
export function useFormDraft(key, blank, options = {}) {
  const { ignore = [], delay = 450 } = options;
  const [value, setValue] = useState(blank);
  const [restored, setRestored] = useState(false);
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;

  const meaningful = useCallback(
    (candidate) =>
      Object.entries(candidate || {}).some(([field, entry]) => {
        if (ignoreRef.current.includes(field)) return false;
        if (Array.isArray(entry)) return entry.length > 0;
        if (entry && typeof entry === "object") return Object.keys(entry).length > 0;
        // A value only counts as typed if it differs from the blank form, so a
        // select left on its default never resurrects an empty draft.
        return String(entry ?? "").trim() !== "" && entry !== blank[field];
      }),
    [blank],
  );

  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || "null");
      if (saved && typeof saved === "object" && meaningful(saved)) {
        setValue({ ...blank, ...saved });
        setRestored(true);
      }
    } catch {
      // A corrupt draft must never block the form from rendering.
      try { window.localStorage.removeItem(key); } catch {}
    }
    // Intentionally keyed only on `key`: restore runs once per user/form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key || typeof window === "undefined") return undefined;
    if (!meaningful(value)) {
      try { window.localStorage.removeItem(key); } catch {}
      return undefined;
    }
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }, delay);
    return () => window.clearTimeout(timer);
  }, [key, value, delay, meaningful]);

  const clear = useCallback(() => {
    if (key && typeof window !== "undefined") {
      try { window.localStorage.removeItem(key); } catch {}
    }
    setRestored(false);
  }, [key]);

  const discard = useCallback(() => {
    clear();
    setValue(blank);
  }, [clear, blank]);

  return { value, setValue, restored, discard, clear };
}

export default useFormDraft;
