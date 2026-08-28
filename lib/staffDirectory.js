const STAFF_DOMAIN = "@ecologyconsulting.au";

export function normaliseStaffEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isEcologyStaffEmail(value) {
  return normaliseStaffEmail(value).endsWith(STAFF_DOMAIN);
}

export function staffDirectoryRecord(user) {
  const meta = user?.user_metadata || {};
  const firstName = String(meta.first_name || meta.firstName || "").trim();
  const lastName = String(meta.last_name || meta.lastName || "").trim();
  const name = String(meta.full_name || meta.name || [firstName, lastName].filter(Boolean).join(" ") || user?.email || "").trim();
  return {
    id: user.id,
    firstName,
    lastName,
    name,
    email: normaliseStaffEmail(user.email),
    phone: String(meta.phone || meta.mobile || "").trim(),
    active: meta.staff_directory_active !== false,
    lastSignIn: user.last_sign_in_at || null,
    createdAt: user.created_at || null,
  };
}

export async function listDirectoryUsers(admin, { activeOnly = false } = {}) {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users
    .filter((user) => isEcologyStaffEmail(user?.email))
    .map(staffDirectoryRecord)
    .filter((person) => !activeOnly || person.active)
    .sort((left, right) => `${left.lastName} ${left.firstName} ${left.email}`.localeCompare(`${right.lastName} ${right.firstName} ${right.email}`, "en-AU"));
}

export function directoryById(directory) {
  return new Map((directory || []).map((person) => [person.id, person]));
}
