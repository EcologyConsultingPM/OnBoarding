const ROLE_COLUMNS = [
  ["Senior Ecologist", "senior_ecologist_rate"],
  ["Ecologist", "ecologist_rate"],
  ["Project Manager", "project_manager_rate"],
];
const CHARGE_ROLE_BY_STAFF = new Map([
  ["d07b78be-c1e7-4bf5-94fa-5366a59cb408", "Senior Ecologist"], // Gerard Dwyer
  ["4eef096c-91da-4135-839d-c8a67b3a5e6f", "Senior Ecologist"], // Emily Zouch
  ["abd4449e-5294-4e18-ad2a-08403cc3e1ce", "Senior Ecologist"], // Simon Vinson
  ["577f0587-e75c-4c35-8013-1b334c348871", "Project Manager"], // Grace Stephenson
  ["2c265989-7864-41ad-9e2d-202d64d9a954", "Project Manager"], // Aaron Dooley
  ["75b7ca74-86d9-4cf5-be17-31ac12947f40", "Project Manager"], // Tony Webster
]);

export function trackerChargeRole(staffUserId) {
  return CHARGE_ROLE_BY_STAFF.get(String(staffUserId || "").toLowerCase()) || "Ecologist";
}

function requiredProjectRate(value, projectId, role) {
  const rate = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000000) {
    throw new Error(`Missing required positive project charge rate for ${role} on project ${projectId}.`);
  }
  return rate;
}

// Missing cards are deliberately absent from the result, not company defaults.
// Company project_role_rates may suggest values in setup, but never price work.
export async function loadTrackerChargeRates(admin, projectIds = []) {
  const ids = [...new Set(projectIds.filter(Boolean))];
  const ratesByProject = new Map();
  // Each batch is bounded by its unique project IDs, so a server row limit
  // cannot silently truncate a large portfolio's confirmed cards.
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const { data, error } = await admin.from("project_charge_rates")
      .select("project_id, senior_ecologist_rate, ecologist_rate, project_manager_rate, confirmed_by, confirmed_at")
      .in("project_id", batch)
      .limit(batch.length);
    if (error) throw new Error(`Unable to load project charge rates: ${error.message}`);
    for (const row of data || []) {
      if (!row.confirmed_by || !row.confirmed_at) continue;
      if (ratesByProject.has(row.project_id)) throw new Error(`Duplicate charge rate cards for project ${row.project_id}.`);
      ratesByProject.set(row.project_id, new Map(ROLE_COLUMNS.map(([role, column]) => [
        role, requiredProjectRate(row[column], row.project_id, role),
      ])));
    }
  }
  return ratesByProject;
}

function legacyChargeRate(legacyRate) {
  const fallback = typeof legacyRate === "number" || typeof legacyRate === "string" ? Number(legacyRate) : NaN;
  if (!Number.isFinite(fallback) || fallback < 0) throw new Error("Invalid legacy tracker charge rate.");
  return fallback;
}

export function trackerCurrentChargeRate(projectId, staffUserId, ratesByProject, legacyRate = 0) {
  const role = trackerChargeRole(staffUserId);
  const projectRates = ratesByProject?.get(projectId);
  return projectRates ? requiredProjectRate(projectRates.get(role), projectId, role) : legacyChargeRate(legacyRate);
}

// Pass database-read entries only. The BEFORE INSERT/UPDATE trigger owns these
// reserved metadata fields; preview/client-supplied custom_data is not trusted.
export function trackerEntryChargeRate(entry, ratesByProject, legacyRate = 0) {
  const role = trackerChargeRole(entry?.staff_user_id);
  const metadata = entry?.custom_data;
  if (metadata?.charge_rate_stamped === true && metadata.charge_role === role) {
    const snapshot = metadata.charge_rate_snapshot;
    if (typeof snapshot !== "number" || !Number.isFinite(snapshot) || snapshot <= 0) {
      throw new Error(`Invalid trusted tracker charge rate snapshot for role ${role}.`);
    }
    return snapshot;
  }
  // Intentionally do not consult ratesByProject for unstamped history. A card
  // confirmed today cannot reprice an old row during ordinary/import refresh.
  return legacyChargeRate(legacyRate);
}

const ADMIN_ONLY_METADATA = new Set([
  "charge_role", "charge_rate_snapshot", "charge_rate_stamped",
  "charge_source", "charge_version", "charge_rate_source", "charge_rate_version",
  "charge_rate_snapshot_source", "charge_rate_snapshot_version",
  "import_expected_charge_rate", "import_charge_role", "import_duplicate_review",
]);

export function trackerResponseCustomData(customData, isAdmin = false) {
  const metadata = customData && typeof customData === "object" && !Array.isArray(customData) ? customData : {};
  if (isAdmin === true) return metadata;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !ADMIN_ONLY_METADATA.has(key)));
}
