import { serviceMonthForSource } from "./projectBudgetPeriods";

// Inputs must be explicit decimal amounts, not blank values coerced to zero,
// booleans, hexadecimal, exponent notation, or silently rounded precision.
export function validMonthlyBudgetAmount(value) {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return false;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1e9;
}

export function monthlyBudgetInputError(monthlyValue, monthlyHours) {
  if (!validMonthlyBudgetAmount(monthlyValue) || !validMonthlyBudgetAmount(monthlyHours)) {
    return "Monthly budget value and hours must each be a non-empty, non-negative decimal number no greater than 1,000,000,000, with at most 2 decimal places.";
  }
  return "";
}

// Call with approved sources only. Non-perioded sources contribute to the
// portfolio aggregate, never to the common per-month input or month count.
export function monthlyBudgetBaselineForSources(approvedSources = []) {
  const monthlySources = approvedSources.filter((source) =>
    Boolean(serviceMonthForSource(source)),
  );
  if (!monthlySources.length) return null;
  const cents = (value) => Math.round(Number(value ?? 0) * 100);
  const first = monthlySources[0];
  const uniqueMonths = new Set(monthlySources.map(serviceMonthForSource)).size === monthlySources.length;
  const uniform = uniqueMonths && monthlySources.every((source) =>
    validMonthlyBudgetAmount(source.approved_value) &&
    validMonthlyBudgetAmount(source.approved_hours) &&
    cents(source.approved_value) === cents(first.approved_value) &&
    cents(source.approved_hours) === cents(first.approved_hours),
  );
  return {
    monthlyValue: uniform ? Number(first.approved_value) : null,
    monthlyHours: uniform ? Number(first.approved_hours) : null,
    monthCount: monthlySources.length,
    aggregateValue: approvedSources.reduce((sum, source) => sum + cents(source.approved_value), 0) / 100,
    aggregateHours: approvedSources.reduce((sum, source) => sum + cents(source.approved_hours), 0) / 100,
    uniform,
  };
}
