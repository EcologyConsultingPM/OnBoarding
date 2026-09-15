"use client";

import { useEffect } from "react";

/**
 * Warn before leaving with unsaved changes.
 *
 * Deliberately NOT localStorage draft retention, which is what useFormDraft
 * does and what the create-forms use. The distinction matters:
 *
 *   A CREATE form holds work that exists nowhere else. Restoring it later is
 *   pure gain — there is no server state to conflict with.
 *
 *   An EDIT form is a copy of a row that other people can also change. Silently
 *   restoring a day-old draft over it would overwrite whoever edited it in the
 *   meantime, with no indication that had happened. That is a data-loss bug
 *   dressed up as a convenience feature.
 *
 * So edit forms get a guard instead: you are told before you lose the changes,
 * and nothing is written behind your back. Stale state is never resurrected.
 *
 * Note this only covers full page unloads and reloads. Next.js client-side
 * navigation does not fire beforeunload, so components should also gate their
 * own in-app close/cancel actions on `dirty`.
 *
 *   useUnsavedGuard(isDirty);
 */
export function useUnsavedGuard(dirty, message = "You have unsaved changes.") {
  useEffect(() => {
    if (!dirty || typeof window === "undefined") return undefined;
    const handler = (event) => {
      event.preventDefault();
      // Modern browsers ignore the custom string and show their own wording,
      // but returnValue must be set for the prompt to appear at all.
      event.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, message]);
}

export default useUnsavedGuard;
