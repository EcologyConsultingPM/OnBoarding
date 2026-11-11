export const EMPLOYMENT_TYPES = Object.freeze([
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "casual", label: "Casual" },
]);
export const REGISTER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isRegisterDate(value) {
  if (typeof value !== "string" || !DATE.test(value) || value.slice(0, 4) === "0000") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function getRegisterToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const part = type => parts.find(p => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function trainingExpiry(expiryDate, asOfDate = getRegisterToday()) {
  if (!expiryDate) return { daysRemaining: null, status: "No expiry recorded", key: "no_expiry" };
  if (!isRegisterDate(expiryDate) || !isRegisterDate(asOfDate)) throw new RangeError("A valid YYYY-MM-DD date is required.");
  const daysRemaining = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86400000);
  if (daysRemaining < 0) return { daysRemaining, status: "Expired", key: "expired" };
  if (daysRemaining <= 14) return { daysRemaining, status: "Due within 14 days", key: "amber" };
  if (daysRemaining <= 30) return { daysRemaining, status: "Due within 30 days", key: "yellow" };
  return { daysRemaining, status: "Current", key: "current" };
}
export function summariseTrainingRecords(records = [], staff = [], asOfDate = getRegisterToday()) {
  const staffById = new Map(staff.filter(row => !row.archived_at).map(row => [row.id, row]));
  const summary = { total: 0, expired: 0, dueWithin14: 0, dueWithin30: 0, alerts: [] };
  for (const row of records) {
    if (row.archived_at || !staffById.has(row.staff_id)) continue;
    summary.total += 1;
    const expiry = trainingExpiry(row.expiry_date, asOfDate);
    if (expiry.key === "expired") summary.expired += 1;
    if (expiry.key === "amber") summary.dueWithin14 += 1;
    if (expiry.key === "yellow") summary.dueWithin30 += 1;
    if (["expired", "amber", "yellow"].includes(expiry.key)) summary.alerts.push({ ...row, staff_name: staffById.get(row.staff_id).staff_name, ...expiry });
  }
  summary.alerts.sort((a, b) => a.daysRemaining - b.daysRemaining || a.staff_name.localeCompare(b.staff_name, "en-AU") || String(a.id).localeCompare(String(b.id)));
  return summary;
}
const object = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function normaliseRegisterText(value, maximum) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum && !/[<>\u0000-\u001f\u007f]/.test(text) ? text : null;
}
function start(input, allowed) {
  const errors = {};
  if (!object(input)) errors.values = "Provide the required fields.";
  else if (Object.keys(input).some(key => !allowed.includes(key))) errors.values = "Unexpected fields are not supported.";
  return { input: object(input) ? input : {}, errors };
}
export function normaliseRegisterStaff(raw) {
  const { input, errors } = start(raw, ["staff_name", "position", "employment_type", "linked_user_id"]);
  const value = { staff_name: normaliseRegisterText(input.staff_name, 150), position: normaliseRegisterText(input.position, 150), employment_type: input.employment_type, linked_user_id: null };
  if (!value.staff_name) errors.staff_name = "Enter a plain-text staff name (maximum 150 characters).";
  if (!value.position) errors.position = "Enter a plain-text position (maximum 150 characters).";
  if (!EMPLOYMENT_TYPES.some(type => type.value === value.employment_type)) errors.employment_type = "Choose Full-time, Part-time or Casual.";
  if (input.linked_user_id !== undefined && input.linked_user_id !== null && input.linked_user_id !== "") {
    if (typeof input.linked_user_id !== "string" || !REGISTER_UUID.test(input.linked_user_id)) errors.linked_user_id = "Choose a valid account or leave it unlinked.";
    else value.linked_user_id = input.linked_user_id.toLowerCase();
  }
  return { value: Object.keys(errors).length ? null : value, errors };
}
export function normaliseTrainingRecord(raw) {
  const { input, errors } = start(raw, ["staff_id", "qualification", "training_organisation", "completion_date", "expiry_date"]);
  const value = { staff_id: typeof input.staff_id === "string" ? input.staff_id.toLowerCase() : input.staff_id, qualification: normaliseRegisterText(input.qualification, 200), training_organisation: normaliseRegisterText(input.training_organisation, 200), completion_date: input.completion_date, expiry_date: input.expiry_date || null };
  if (typeof value.staff_id !== "string" || !REGISTER_UUID.test(value.staff_id)) errors.staff_id = "Choose a staff record.";
  if (!value.qualification) errors.qualification = "Enter a plain-text qualification (maximum 200 characters).";
  if (!value.training_organisation) errors.training_organisation = "Enter a plain-text training organisation (maximum 200 characters).";
  if (!isRegisterDate(value.completion_date)) errors.completion_date = "Enter a valid completion date (YYYY-MM-DD).";
  if (input.expiry_date !== undefined && input.expiry_date !== null && input.expiry_date !== "" && !isRegisterDate(input.expiry_date)) errors.expiry_date = "Enter a valid expiry date or leave it blank.";
  else if (value.expiry_date && !errors.completion_date && value.expiry_date < value.completion_date) errors.expiry_date = "Expiry cannot be earlier than completion.";
  return { value: Object.keys(errors).length ? null : value, errors };
}
