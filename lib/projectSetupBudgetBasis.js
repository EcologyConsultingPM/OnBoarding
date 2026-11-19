import { serviceMonthForSource } from "./projectBudgetPeriods.js";

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


// Project Operations exposes the ordinary project-register budget as the
// original-scope baseline. Keep approved variations additive and never rewrite
// monthly sources or actual tracker consumption through this path.
export function projectOperationsBudgetSync({ approvedSources = [], allSources = [], body = {}, monthlyBudgetControlled = false, masterBudgetChanged = false } = {}) {
  const hasBudgetInput = Object.hasOwn(body, "budgetHours") || Object.hasOwn(body, "budgetDollars");
  if (!hasBudgetInput || monthlyBudgetControlled || !allSources.length) {
    return { sourceId: "", patch: {}, synchronized: false, error: "" };
  }

  const originals = approvedSources.filter((source) =>
    source.source_type === "original" && !source.service_period_start && !source.service_period_end,
  );
  if (originals.length !== 1) {
    if (!masterBudgetChanged) return { sourceId: "", patch: {}, synchronized: false, error: "" };
    return {
      sourceId: "",
      patch: {},
      synchronized: false,
      status: 409,
      error: "This project has budget sources but no unique approved original-scope baseline. Update or approve the original source in Project Tracker before changing the Project Operations budget; the tracker balance was not changed.",
    };
  }

  const source = originals[0];
  const patch = {};
  if (Object.hasOwn(body, "budgetHours")) {
    if (!validMonthlyBudgetAmount(body.budgetHours)) {
      return { sourceId: "", patch: {}, synchronized: false, status: 400, error: "Budget hours must be a non-negative decimal amount with at most two decimal places." };
    }
    const value = Number(body.budgetHours);
    if (Math.round(Number(source.approved_hours || 0) * 100) !== Math.round(value * 100)) patch.approved_hours = value;
  }
  if (Object.hasOwn(body, "budgetDollars")) {
    if (!validMonthlyBudgetAmount(body.budgetDollars)) {
      return { sourceId: "", patch: {}, synchronized: false, status: 400, error: "Budget dollars must be a non-negative decimal amount with at most two decimal places." };
    }
    const value = Number(body.budgetDollars);
    if (Math.round(Number(source.approved_value || 0) * 100) !== Math.round(value * 100)) patch.approved_value = value;
  }
  return {
    sourceId: source.id,
    expectedSource: { approved_value: source.approved_value ?? null, approved_hours: source.approved_hours ?? null },
    patch,
    synchronized: true,
    error: "",
  };
}
