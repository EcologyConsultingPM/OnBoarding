// Service periods are inclusive ISO dates, deliberately independent of timezone.
export function validBudgetDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function monthBudgetPeriod(month) {
  if (!month) return { service_period_start: null, service_period_end: null };
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000-")) throw new Error("Choose a valid service month.");
  const start = `${month}-01`;
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { service_period_start: start, service_period_end: date.toISOString().slice(0, 10) };
}

export function budgetPeriodError(source) {
  const start = source?.service_period_start ?? null;
  const end = source?.service_period_end ?? null;
  if (start === null && end === null) return "";
  if (!validBudgetDate(start) || !validBudgetDate(end) || start > end) return "Service period requires both valid dates, with the end on or after the start.";
  return "";
}

// Omitted fields from older clients must not clear an existing service period.
export function budgetPeriodPatch(input) {
  if (Object.hasOwn(input, "serviceMonth")) return monthBudgetPeriod(input.serviceMonth);
  const hasStart = Object.hasOwn(input, "service_period_start") || Object.hasOwn(input, "servicePeriodStart");
  const hasEnd = Object.hasOwn(input, "service_period_end") || Object.hasOwn(input, "servicePeriodEnd");
  if (!hasStart && !hasEnd) return {};
  if (!hasStart || !hasEnd) throw new Error("Supply both service period dates, or clear both.");
  const result = {
    service_period_start: (input.service_period_start ?? input.servicePeriodStart) || null,
    service_period_end: (input.service_period_end ?? input.servicePeriodEnd) || null,
  };
  const error = budgetPeriodError(result);
  if (error) throw new Error(error);
  return result;
}

export function hasBudgetPeriod(source) {
  return source?.service_period_start != null || source?.service_period_end != null;
}

export function budgetSourceMatchesDate(source, workDate) {
  if (!hasBudgetPeriod(source)) return true;
  return !budgetPeriodError(source) && validBudgetDate(workDate) && workDate >= source.service_period_start && workDate <= source.service_period_end;
}

export function serviceMonthForSource(source) {
  if (budgetPeriodError(source) || !hasBudgetPeriod(source)) return "";
  const month = source.service_period_start.slice(0, 7);
  const bounds = monthBudgetPeriod(month);
  return bounds.service_period_start === source.service_period_start && bounds.service_period_end === source.service_period_end ? month : "";
}

export function budgetPeriodLabel(source) {
  if (!hasBudgetPeriod(source)) return "";
  const month = serviceMonthForSource(source);
  if (month) return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
  return `${source.service_period_start} to ${source.service_period_end}`;
}

function categoryKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function allocationMatchesCategory(allocation, category) {
  const key = categoryKey(category);
  return Boolean(key) && (categoryKey(allocation?.allocation_name) === key || categoryKey(allocation?.allocation_code) === key.slice(0, 40));
}

export function budgetEntryPeriodError(source, workDate, allocation, category) {
  if (!validBudgetDate(workDate)) return "Choose a valid work date.";
  if (!budgetSourceMatchesDate(source, workDate)) return `Work date must fall within this budget's service period (${budgetPeriodLabel(source)}). Choose the approved budget for the work month.`;
  if (hasBudgetPeriod(source) && !allocationMatchesCategory(allocation, category)) return "Choose the monthly budget allocation matching the activity category.";
  return "";
}

// No fallback to an unrestricted original when a monthly budget is missing.
// Legacy, non-perioded projects retain their existing allocation behaviour.
export function selectBudgetForDate(project, form, { preserve = false, preferredSourceId = "" } = {}) {
  const sources = project?.sources || [];
  const available = sources.filter((source) => budgetSourceMatchesDate(source, form.workDate));
  const current = sources.find((source) => source.id === form.sourceId);
  if (preserve && current && budgetSourceMatchesDate(current, form.workDate)) return { ...form };
  const approved = available.filter((source) => !source.approval_status || source.approval_status === "approved");
  const monthly = approved.filter(hasBudgetPeriod);
  const candidates = preferredSourceId
    ? approved.filter((source) => source.id === preferredSourceId)
    : sources.some(hasBudgetPeriod) ? monthly : approved;
  const category = form.category || project?.template?.category_options?.[0] || "";
  const matches = candidates.flatMap((source) => (source.allocations || [])
    .filter((allocation) => !allocation.historicalOnly && (!hasBudgetPeriod(source) || allocationMatchesCategory(allocation, category)))
    .map((allocation) => ({ source, allocation })));
  const match = matches.find(({ source, allocation }) => source.id === form.sourceId && allocation.id === form.allocationId)
    || matches.find(({ source }) => source.id === form.sourceId) || matches[0];
  return { ...form, category, sourceId: match?.source.id || "", allocationId: match?.allocation.id || "" };
}

export function missingBudgetMessage(project, workDate) {
  const sources = project?.sources || [];
  if (sources.some(hasBudgetPeriod) && !sources.some((source) => hasBudgetPeriod(source) && (!source.approval_status || source.approval_status === "approved") && budgetSourceMatchesDate(source, workDate))) return "No approved service-month budget exists for this work date. Ask the Project Manager to approve the correct month's budget and allocation.";
  return "No available budget allocation matches this activity category and work date. Ask the Project Manager to configure it.";
}
