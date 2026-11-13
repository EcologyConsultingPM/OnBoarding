// Explicit unknown effort is separate from confirmed zero. Numeric storage may
// retain an earlier estimate for audit; consumers must use the flag first.
export function hoursTbc(row, kind = "budget") {
  const camel = kind === "allocated" ? "allocatedHoursTbc" : "budgetHoursTbc";
  return row?.[camel] === true || row?.[`${kind}_hours_tbc`] === true;
}

export function confirmedHours(value, tbc = false) {
  if (tbc || value == null || String(value).trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveHoursInput(input = {}, previous = {}, kind = "budget") {
  const camel = kind === "allocated" ? "allocatedHours" : "budgetHours";
  const snake = `${kind}_hours`;
  const flag = `${camel}Tbc`;
  const snakeFlag = `${snake}_tbc`;
  // Some older callers construct an undefined property: it still means omitted.
  const has = (key) => Object.hasOwn(input, key) && input[key] !== undefined;
  const supplied = has(camel) || has(snake);
  const suppliedFlag = has(flag) || has(snakeFlag);
  const value = has(camel) ? input[camel] : input[snake];
  const flagValue = has(flag) ? input[flag] : input[snakeFlag];
  if (suppliedFlag && typeof flagValue !== "boolean") return { error: "TBC hours flags must be boolean." };
  const blank = supplied && (value == null || (typeof value === "string" && value.trim() === ""));
  const priorValue = previous[camel] ?? previous[snake];
  const prior = confirmedHours(priorValue);
  const parsed = supplied && !blank ? confirmedHours(value) : prior;
  if (supplied && !blank && parsed == null) return { error: "Hours must be a nonnegative number or blank for TBC." };
  if (suppliedFlag && flagValue === false && !supplied && hoursTbc(previous, kind)) return { error: "Provide confirmed hours to clear TBC." };
  // An explicit true flag can accompany the known partial sum of a plan. A
  // numeric input without that override confirms the effort, including zero.
  const tbc = blank || flagValue === true || (!supplied && !suppliedFlag && (hoursTbc(previous, kind) || prior == null));
  return { value: blank ? 0 : parsed ?? 0, tbc, supplied: supplied || suppliedFlag };
}

export function hoursPayload(row, kind = "budget") {
  const camel = kind === "allocated" ? "allocatedHours" : "budgetHours";
  const snake = `${kind}_hours`;
  const raw = row?.[camel] ?? row?.[snake];
  const tbc = hoursTbc(row, kind) || confirmedHours(raw) == null;
  const value = confirmedHours(raw, tbc);
  return { [camel]: value, [snake]: value, [`${camel}Tbc`]: tbc, [`${snake}_tbc`]: tbc };
}

export function knownAllocationTotal(assignees = []) {
  return assignees.reduce((sum, row) => sum + (confirmedHours(row.allocatedHours ?? row.allocated_hours, hoursTbc(row, "allocated")) ?? 0), 0);
}

export function allocationBudgetError(assignees, budget, budgetTbc) {
  // An unknown parent is not a numeric allowance. Only known allocations are
  // compared, and only when the parent's budget is confirmed.
  return !budgetTbc && confirmedHours(budget) != null && knownAllocationTotal(assignees) > budget
    ? "Total allocated staff hours cannot exceed this activity's budget hours."
    : null;
}

// Preserve existing reads while an additive migration/PostgREST cache is staged.
// Never mistake a missing TBC column for a missing assignment relation.
export async function selectWithHoursFlags(makeQuery, columns) {
  let result = await makeQuery(columns);
  const message = String(result.error?.message || "");
  if (result.error && /(?:budget|allocated)_hours_tbc/i.test(message)) {
    result = await makeQuery(columns.replace(/,?\s*(?:budget|allocated)_hours_tbc/g, ""));
    return { ...result, hoursTbcReady: false };
  }
  return { ...result, hoursTbcReady: !result.error };
}

export function resolveAssigneeInput(body = {}, budgetHours, budgetTbc = false, fallback = []) {
  let raw;
  let scalarMode = false;
  if (Object.hasOwn(body, "assignees")) {
    if (!Array.isArray(body.assignees)) return { error: "assignees must be an array." };
    raw = body.assignees;
  } else if (Object.hasOwn(body, "staffUserIds")) {
    if (!Array.isArray(body.staffUserIds)) return { error: "staffUserIds must be an array." };
    raw = body.staffUserIds;
  } else if (Object.hasOwn(body, "staffUserId") || Object.hasOwn(body, "staff_user_id")) {
    const staffUserId = body.staffUserId ?? body.staff_user_id;
    raw = staffUserId ? [{ ...body, staffUserId }] : [];
    scalarMode = true;
  } else return { assignees: fallback, supplied: false, explicit: false };
  const seen = new Set();
  const assignees = [];
  for (const candidate of raw) {
    const source = typeof candidate === "string" ? { staffUserId: candidate } : candidate || {};
    const staffUserId = String(source.staffUserId ?? source.staff_user_id ?? source.id ?? "").trim();
    if (!staffUserId || seen.has(staffUserId)) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(staffUserId)) return { error: "Choose valid staff members for this activity." };
    const previous = fallback.find((row) => (row.staffUserId ?? row.staff_user_id) === staffUserId)
      || { allocatedHours: scalarMode ? budgetHours : 0, allocatedHoursTbc: scalarMode ? budgetTbc : true };
    const hours = resolveHoursInput(source, previous, "allocated");
    if (hours.error) return hours;
    seen.add(staffUserId);
    assignees.push({ staffUserId, allocatedHours: hours.value, allocatedHoursTbc: hours.tbc, role: typeof source.role === "string" && source.role.trim() ? source.role.trim().slice(0, 100) : previous.role || "contributor" });
  }
  return { assignees, supplied: true, explicit: true, scalarMode };
}
