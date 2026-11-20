import { createHash } from "node:crypto";
import { normaliseImportText, timesheetDuplicateKey } from "./projectTimesheetImport.js";

export function timesheetCoreKey(row) {
  return [row.workDate, row.staffUserId, row.projectId, normaliseImportText(row.activityCategory)].join("::");
}

export function timesheetWeekStart(workDate) {
  const date = new Date(`${workDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function timesheetWeekEnd(workDate) {
  const start = timesheetWeekStart(workDate);
  if (!start) return "";
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

export function trackerEntryAsImportRow(entry) {
  return {
    id: entry.id,
    workDate: entry.work_date,
    staffUserId: entry.staff_user_id,
    projectId: entry.project_id,
    activityCategory: entry.activity_category,
    hours: Number(entry.hours),
    km: entry.custom_data?.km ?? entry.custom_data?.kilometres ?? null,
    comments: entry.activity_information === "Imported weekly timesheet entry — no comments supplied." ? "" : entry.activity_information || "",
    updatedAt: entry.updated_at,
    enteredByAdmin: Boolean(entry.entered_by_admin_id),
    snapshot: {
      id: entry.id,
      updated_at: entry.updated_at,
      work_date: entry.work_date,
      hours: Number(entry.hours),
      activity_category: entry.activity_category,
      activity_information: entry.activity_information,
      km: entry.custom_data?.km ?? null,
      kilometres: entry.custom_data?.kilometres ?? null,
    },
  };
}

function cents(value) { return Math.round((Number(value) || 0) * 100); }
function rounded(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function reconcileTimesheetRows(rows, existingEntries) {
  const existing = existingEntries.filter((entry) => Number(entry.hours) > 0).map(trackerEntryAsImportRow);
  const existingByCore = new Map();
  for (const entry of existing) {
    const key = timesheetCoreKey(entry);
    if (!existingByCore.has(key)) existingByCore.set(key, []);
    existingByCore.get(key).push(entry);
  }
  const fileByCore = new Map();
  for (const row of rows) {
    if (row.issues.length) continue;
    const key = timesheetCoreKey(row);
    if (!fileByCore.has(key)) fileByCore.set(key, []);
    fileByCore.get(key).push(row);
  }
  const seenExact = new Set();
  for (const row of rows) {
    row.possibleDuplicates = [];
    row.fileOverlaps = [];
    row.reviewExpectedEntries = [];
    row.isSkipped = row.duplicateDecision === "skip";
    if (row.issues.length) {
      row.isImportable = false;
      continue;
    }
    const exactKey = timesheetDuplicateKey(row);
    const coreKey = timesheetCoreKey(row);
    const matches = (existingByCore.get(coreKey) || []).sort((a, b) => a.id.localeCompare(b.id));
    const peers = (fileByCore.get(coreKey) || []).filter((peer) => peer.sourceRow !== row.sourceRow && timesheetDuplicateKey(peer) !== exactKey).sort((a, b) => a.sourceRow - b.sourceRow);
    const exactExisting = matches.some((entry) => timesheetDuplicateKey(entry) === exactKey);
    if (exactExisting || seenExact.has(exactKey)) {
      row.issues.push({ code: exactExisting ? "duplicate_existing" : "duplicate_file", message: exactExisting ? "An identical tracker entry already exists; this row is skipped." : "An identical row is repeated in this file; this copy is skipped." });
      row.isSkipped = true;
      row.isImportable = false;
      row.duplicateDecision = "skip";
      continue;
    }
    seenExact.add(exactKey);
    row.possibleDuplicates = matches.map(({ snapshot, ...entry }) => ({ ...entry, staffLabel: row.staffLabel }));
    row.fileOverlaps = peers.map((peer) => ({ sourceRow: peer.sourceRow, hours: peer.hours, comments: peer.comments, km: peer.km, activityCategory: peer.activityCategory }));
    row.reviewExpectedEntries = matches.map((entry) => entry.snapshot);
    const hasOverlap = matches.length > 0 || peers.length > 0;
    if (hasOverlap) {
      const identity = { workDate: row.workDate, staffUserId: row.staffUserId, projectId: row.projectId, activityCategory: normaliseImportText(row.activityCategory), hours: row.hours, km: row.km, comments: row.comments };
      const token = createHash("sha256").update(JSON.stringify({ identity, entries: row.reviewExpectedEntries, peers: row.fileOverlaps })).digest("hex");
      const suppliedToken = row.duplicateReviewToken;
      row.duplicateReviewToken = token;
      const groupRows = fileByCore.get(coreKey) || [];
      const uploadedHours = rounded(groupRows.reduce((sum, peer) => sum + Number(peer.hours || 0), 0));
      const existingHours = rounded(matches.reduce((sum, entry) => sum + Number(entry.hours || 0), 0));
      row.warnings.push(`Possible overlap: ${matches.length} existing entries (${existingHours} h) and ${groupRows.length} uploaded rows (${uploadedHours} h) share staff, project, date and category. Notes, km or hours differ.`);
      if (matches.length > 50) row.issues.push({ code: "too_many_related_entries", message: "More than 50 related entries exist for this date/category. Skip this row and reconcile it in the tracker." });
      if (row.duplicateDecision === "separate") {
        row.isSkipped = false;
        if ((row.duplicateReason || "").trim().length < 10 || !/[\p{L}\p{N}]/u.test(row.duplicateReason || "")) row.issues.push({ code: "duplicate_reason_required", message: "Explain why this is separate work using at least 10 characters." });
        if (suppliedToken !== token) row.issues.push({ code: "duplicate_review_changed", message: "The related entries or uploaded row changed. Review the current comparison before confirming separate work." });
      } else {
        row.duplicateDecision = "skip";
        row.isSkipped = true;
      }
    } else {
      row.duplicateReviewToken = "";
      row.duplicateReason = "";
      if (row.duplicateDecision === "separate") row.duplicateDecision = "";
    }
    row.isImportable = !row.isSkipped && row.issues.length === 0;
  }

  const groups = new Map();
  for (const row of rows) {
    if (!row.projectId || !row.staffUserId || !row.workDate) continue;
    const weekStart = timesheetWeekStart(row.workDate);
    const key = [row.staffUserId, row.projectId, weekStart].join("::");
    const group = groups.get(key) || { staffUserId: row.staffUserId, projectId: row.projectId, staffLabel: row.staffLabel, projectLabel: row.projectLabel, weekStart, existingHours: 0, uploadHours: 0, newHours: 0, excludedHours: 0, unresolvedHours: 0, labourCharge: 0 };
    group.uploadHours += cents(row.hours);
    if (row.isImportable) {
      group.newHours += cents(row.hours);
      group.labourCharge += cents(row.chargeAmount);
    } else if (row.isSkipped) group.excludedHours += cents(row.hours);
    else group.unresolvedHours += cents(row.hours);
    groups.set(key, group);
  }
  for (const entry of existing) {
    const key = [entry.staffUserId, entry.projectId, timesheetWeekStart(entry.workDate)].join("::");
    if (groups.has(key)) groups.get(key).existingHours += cents(entry.hours);
  }
  const reconciliation = [...groups.values()].map((group) => ({
    ...group,
    existingHours: group.existingHours / 100,
    uploadHours: group.uploadHours / 100,
    newHours: group.newHours / 100,
    excludedHours: group.excludedHours / 100,
    unresolvedHours: group.unresolvedHours / 100,
    labourCharge: group.labourCharge / 100,
    resultingHours: (group.existingHours + group.newHours) / 100,
  })).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.staffLabel.localeCompare(b.staffLabel) || a.projectLabel.localeCompare(b.projectLabel));
  return { rows, reconciliation };
}
