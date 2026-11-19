export const TIMESHEET_IMPORT_FIELDS = [
  { key: "workDate", label: "Work date", required: true, aliases: ["date", "work date", "work_date", "workday", "day"] },
  { key: "staffName", label: "Staff name", required: true, aliases: ["staff", "staff name", "employee", "employee name", "consultant", "worker"] },
  { key: "clientName", label: "Client", required: false, aliases: ["client", "client name", "customer", "company"] },
  { key: "projectName", label: "Project name", required: false, aliases: ["project", "project name", "job", "job name", "project title"] },
  { key: "projectNumber", label: "Project number", required: false, aliases: ["project number", "project no", "project #", "project code", "job number", "job code"] },
  { key: "hours", label: "Hours", required: true, aliases: ["hours", "total hours", "time", "hrs", "qty"] },
  { key: "km", label: "Kilometres", required: false, aliases: ["km", "kms", "kilometre", "kilometres", "kilometer", "kilometers", "distance"] },
  { key: "activityCategory", label: "Activity category", required: true, aliases: ["activity category", "category", "cost code", "activity", "task", "service"] },
  { key: "comments", label: "Comments", required: false, aliases: ["comments", "comment", "description", "notes", "work details", "narrative"] },
];

export function normaliseImportText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function inferTimesheetColumnMap(headers = []) {
  const normalised = headers.map((header) => normaliseImportText(header));
  return Object.fromEntries(TIMESHEET_IMPORT_FIELDS.map((field) => {
    const aliases = new Set(field.aliases.map(normaliseImportText));
    const index = normalised.findIndex((header) => aliases.has(header));
    return [field.key, index < 0 ? "" : index];
  }));
}

function cellAt(row, index) {
  if (index === "" || index === null || index === undefined) return "";
  const value = row?.values?.[Number(index)];
  return value instanceof Date ? value.toISOString().slice(0, 10) : value ?? "";
}

export function mapRawTimesheetRows(rawRows = [], mapping = {}) {
  return rawRows.map((row) => ({
    sourceRow: Number(row.rowNumber) || 0,
    workDate: cellAt(row, mapping.workDate),
    staffName: String(cellAt(row, mapping.staffName) ?? "").trim(),
    clientName: String(cellAt(row, mapping.clientName) ?? "").trim(),
    projectName: String(cellAt(row, mapping.projectName) ?? "").trim(),
    projectNumber: String(cellAt(row, mapping.projectNumber) ?? "").trim(),
    hours: cellAt(row, mapping.hours),
    km: cellAt(row, mapping.km),
    activityCategory: String(cellAt(row, mapping.activityCategory) ?? "").trim(),
    comments: String(cellAt(row, mapping.comments) ?? "").trim(),
  })).filter((row) => Object.values(row).some((value) => value !== "" && value !== null && value !== undefined));
}

function validIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) return "";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normaliseWorkDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const input = String(value ?? "").trim();
  if (!input) return "";
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);
  const local = input.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (local) {
    let year = Number(local[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    // The staff portal uses en-AU dates, so ambiguous numeric dates are day/month/year.
    return validIsoDate(year, local[2], local[1]);
  }
  const namedMonth = input.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (namedMonth) {
    const month = new Date(`${namedMonth[2]} 1, 2000`).getMonth() + 1;
    if (!Number.isFinite(month)) return "";
    return validIsoDate(namedMonth[3], month, namedMonth[1]);
  }
  return "";
}

export function normaliseImportNumber(value, { allowBlank = false, maximum = 100000 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return allowBlank ? null : NaN;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= maximum ? value : NaN;
  let input = String(value).trim().replace(/\s/g, "");
  if (input.includes(",")) {
    const groupedThousands = /^\d{1,3}(?:,\d{3})+$/.test(input);
    if (!input.includes(".") && !groupedThousands) input = input.replace(",", ".");
    else input = input.replace(/,/g, "");
  }
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(input)) return NaN;
  const result = Number(input);
  return Number.isFinite(result) && result >= 0 && result <= maximum ? result : NaN;
}

export function decimalImportFixed2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "NaN";
  const [base, exponent = "0"] = number.toString().split("e");
  const shifted = Number(`${base}e${Number(exponent) + 2}`);
  return (Math.round(shifted) / 100).toFixed(2);
}

export function timesheetDuplicateKey(row) {
  const hoursValue = Number(row.hours);
  const kmValue = row.km === null || row.km === undefined || row.km === "" ? "" : decimalImportFixed2(row.km);
  return [
    row.workDate,
    row.staffUserId,
    row.projectId,
    normaliseImportText(row.activityCategory),
    Number.isFinite(hoursValue) ? decimalImportFixed2(hoursValue) : "",
    kmValue,
    normaliseImportText(row.comments),
  ].join("::");
}
