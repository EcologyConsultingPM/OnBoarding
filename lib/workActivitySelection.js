// UI-only identities: persisted IDs never depend on row order or edited content.
let nextClientId = 0;
export const withActivityClientId = (activity) => activity.id || activity.clientId
  ? activity
  : { ...activity, clientId: globalThis.crypto?.randomUUID?.() || `activity-${Date.now()}-${++nextClientId}` };

export const activitySelectionKey = (activity) => activity.id
  ? `saved:${activity.id}`
  : `draft:${activity.clientId}`;

// A client ID may survive browser draft restoration, but no UI metadata is sent
// to the upsert endpoint. Selection itself lives only in component state.
export const stripActivityUiFields = (activity) => {
  const { clientId, selected, isSelected, selectionKey, ...fields } = activity;
  return fields;
};

export const activityRemovalConfirmation = (rows) => {
  const preview = rows.slice(0, 5).map((row) => `• ${row.title?.trim() || "Untitled activity"}`).join("\n");
  const extra = rows.length > 5 ? `\n…and ${rows.length - 5} more.` : "";
  const savedCount = rows.filter((row) => row.id).length;
  return `Delete ${rows.length} selected work activit${rows.length === 1 ? "y" : "ies"} from the active plan?\n\n${preview}${extra}\n\n${savedCount ? "Saved activities will be retired immediately. Unanswered assignment notifications and standalone generated Gantt rows will be withdrawn; shared schedule rows remain while other active activities use them. Tracker records and retained history remain auditable.\n\n" : ""}Unsaved selected rows are removed only from this browser draft. Unselected edits will not be saved or changed. This cannot be undone in the editor.`;
};

// DELETE is deliberately sequential, not an upsert or an all-or-nothing promise.
// Stop on the first error, keeping failed/unattempted rows available for retry.
export async function retireSelectedWorkActivities({ rows, projectId, auth, onProgress }) {
  const completedKeys = new Set();
  let requestError = null;
  let reconciliationError = null;
  let reconciledRetirement = false;
  for (const row of rows) {
    try {
      if (row.id) {
        const response = await auth("DELETE", `/api/projects/${projectId}/activities?id=${encodeURIComponent(row.id)}`);
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Could not confirm activity deletion.");
      }
      completedKeys.add(activitySelectionKey(row));
      onProgress?.(completedKeys.size);
    } catch (error) {
      requestError = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  // The route retires the activity before withdrawing notices/Gantt rows. A
  // failed response (including a lost response) therefore isn't proof of an
  // active row. Reconcile ONLY original selected IDs, never replace editor data.
  if (requestError && rows.some((row) => row.id)) {
    try {
      const response = await auth("GET", `/api/projects/${projectId}/activities`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.activities)) throw new Error(data.error || "Could not verify remaining active activities.");
      const activeIds = new Set(data.activities.filter((row) => row.is_active !== false).map((row) => row.id));
      for (const row of rows) {
        const key = activitySelectionKey(row);
        if (row.id && !activeIds.has(row.id) && !completedKeys.has(key)) {
          completedKeys.add(key);
          reconciledRetirement = true;
        }
      }
      onProgress?.(completedKeys.size);
    } catch (error) {
      reconciliationError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    completedKeys,
    remainingKeys: new Set(rows.map(activitySelectionKey).filter((key) => !completedKeys.has(key))),
    retiredSavedCount: rows.filter((row) => row.id && completedKeys.has(activitySelectionKey(row))).length,
    requestError,
    reconciliationError,
    reconciledRetirement,
  };
}
