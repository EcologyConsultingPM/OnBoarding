import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { createHash, randomUUID } from "node:crypto";
import { loadTrackerChargeRates, trackerChargeRole } from "../../../../lib/projectTrackerChargeRates";
import { reconcileTimesheetRows, timesheetWeekEnd, timesheetWeekStart } from "../../../../lib/projectTimesheetReconciliation";
import {
  allocationMatchesCategory,
  budgetSourceMatchesDate,
  hasBudgetPeriod,
  validBudgetDate,
} from "../../../../lib/projectBudgetPeriods";
import {
  inferTimesheetColumnMap,
  normaliseImportNumber,
  normaliseImportText,
  normaliseWorkDate,
  timesheetDuplicateKey,
} from "../../../../lib/projectTimesheetImport";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;
const MAX_IMPORT_COLUMNS = 30;
const PAGE_SIZE = 1000;

function jsonError(error, status = 400, extra = {}) {
  return Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
}

function tableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || message.includes("does not exist") || message.includes("schema cache");
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function cleanText(value, maximum = 5000) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maximum);
}

function safeFileName(value) {
  const name = String(value || "weekly-timesheets").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").trim();
  return name.slice(0, 180) || "weekly-timesheets";
}

function normaliseDateValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 20000 && value <= 100000) {
    const serial = XLSX.SSF.parse_date_code(value);
    if (serial) return normaliseWorkDate(`${String(serial.y).padStart(4, "0")}-${String(serial.m).padStart(2, "0")}-${String(serial.d).padStart(2, "0")}`);
  }
  return normaliseWorkDate(value);
}

function normaliseProjectNumber(value) {
  return normaliseImportText(value).replace(/\s+/g, "");
}

function userName(user) {
  const metadata = user?.user_metadata || {};
  const fullName = metadata.full_name || metadata.name || [metadata.first_name, metadata.last_name].filter(Boolean).join(" ");
  const verifiedName = user?.id === "2c265989-7864-41ad-9e2d-202d64d9a954" ? "Aaron Dooley" : "";
  return String(fullName || verifiedName || user?.email || "Staff member").trim();
}

async function readProjectNumbers(admin, projectIds) {
  const byProject = new Map(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return byProject;
  const linksResult = await admin.from("quote_draft_projects").select("project_id, quote_id").in("project_id", projectIds);
  if (linksResult.error) {
    if (tableUnavailable(linksResult.error)) return byProject;
    throw new Error(linksResult.error.message);
  }
  const links = linksResult.data || [];
  const quoteIds = [...new Set(links.map((row) => row.quote_id).filter(Boolean))];
  if (!quoteIds.length) return byProject;
  const draftsResult = await admin.from("quote_drafts").select("transferred_quote_id, project_number").in("transferred_quote_id", quoteIds);
  if (draftsResult.error) {
    if (tableUnavailable(draftsResult.error)) return byProject;
    throw new Error(draftsResult.error.message);
  }
  const numberByQuote = new Map((draftsResult.data || []).filter((row) => row.project_number).map((row) => [row.transferred_quote_id, String(row.project_number)]));
  for (const link of links) {
    const number = numberByQuote.get(link.quote_id);
    if (number && byProject.has(link.project_id) && !byProject.get(link.project_id).includes(number)) byProject.get(link.project_id).push(number);
  }
  return byProject;
}

async function loadImportContext(admin) {
  const projectsResult = await admin.from("projects")
    .select("id, name, client_name, status, deleted_at, default_hourly_rate")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (projectsResult.error) throw new Error(projectsResult.error.message);
  const projects = projectsResult.data || [];
  const ids = projects.map((project) => project.id);
  if (!ids.length) return { projects: [], staff: [], projectOptions: [], staffOptions: [], rateByProject: new Map() };

  const [sourcesResult, allocationsResult, templatesResult, usersResult] = await Promise.all([
    admin.from("project_budget_sources")
      .select("id, project_id, source_code, source_name, source_type, approval_status, approved_value, approved_hours, service_period_start, service_period_end")
      .in("project_id", ids),
    admin.from("project_budget_allocations")
      .select("id, project_id, budget_source_id, allocation_code, allocation_name, allocation_hours, allocation_value, status, staff_visible")
      .in("project_id", ids),
    admin.from("project_tracker_templates")
      .select("project_id, category_options, column_definitions, locked")
      .in("project_id", ids),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const failed = [sourcesResult, allocationsResult, templatesResult].find((result) => result.error);
  if (failed?.error) {
    if (tableUnavailable(failed.error)) throw new Error("Project Tracker budget sources and allocations are not ready for import. Configure the active project tracker first.");
    throw new Error(failed.error.message);
  }
  if (usersResult.error) throw new Error(usersResult.error.message);

  const [projectNumbers, rateByProject] = await Promise.all([readProjectNumbers(admin, ids), loadTrackerChargeRates(admin, ids)]);
  const sourcesByProject = new Map(ids.map((id) => [id, []]));
  for (const source of sourcesResult.data || []) if (sourcesByProject.has(source.project_id)) sourcesByProject.get(source.project_id).push(source);
  const allocationsByProject = new Map(ids.map((id) => [id, []]));
  for (const allocation of allocationsResult.data || []) if (allocationsByProject.has(allocation.project_id)) allocationsByProject.get(allocation.project_id).push(allocation);
  const templateByProject = new Map((templatesResult.data || []).map((template) => [template.project_id, template]));
  const projectsWithContext = projects.map((project) => ({
    ...project,
    projectNumbers: projectNumbers.get(project.id) || [],
    sources: sourcesByProject.get(project.id) || [],
    allocations: allocationsByProject.get(project.id) || [],
    template: templateByProject.get(project.id) || { category_options: [], column_definitions: [] },
  }));
  const staff = (usersResult.data?.users || []).filter((user) => {
    if (user.deleted_at) return false;
    const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : NaN;
    return !Number.isFinite(bannedUntil) || bannedUntil <= Date.now();
  }).map((user) => ({ id: user.id, name: userName(user), email: user.email || "" }));

  return {
    projects: projectsWithContext,
    staff,
    rateByProject,
    projectOptions: projectsWithContext.map((project) => ({
      id: project.id,
      name: project.name,
      clientName: project.client_name || "",
      projectNumbers: project.projectNumbers,
      categoryOptions: [...new Set([
        ...(Array.isArray(project.template.category_options) ? project.template.category_options : []),
        ...project.allocations.filter((allocation) => allocation.status === "active" && allocation.staff_visible).map((allocation) => allocation.allocation_name),
      ].filter(Boolean))],
    })),
    staffOptions: staff,
  };
}

function projectMatches(row, context) {
  const textName = normaliseImportText(row.projectName);
  const inputNumber = normaliseProjectNumber(row.projectNumber);
  const client = normaliseImportText(row.clientName);
  const warnings = [];
  if (row.projectId) {
    const selected = context.projects.find((project) => project.id === row.projectId);
    if (selected && row.clientName && selected.client_name && normaliseImportText(selected.client_name) !== client) warnings.push("Source client name differs from the selected project's client; confirm this match before importing.");
    return { matches: selected ? [selected] : [], warnings: selected ? warnings : ["Selected project is no longer active."] };
  }
  let byNumber = [];
  if (inputNumber) byNumber = context.projects.filter((project) => project.projectNumbers.some((value) => normaliseProjectNumber(value) === inputNumber));
  let byName = [];
  if (textName) {
    byName = context.projects.filter((project) => normaliseImportText(project.name) === textName);
    if (!byName.length) {
      byName = context.projects.filter((project) => {
        const identityText = normaliseImportText(`${row.projectName} ${row.projectNumber}`);
        return identityText.length >= 5 && identityText.includes(normaliseImportText(project.name));
      });
    }
  }
  if (byNumber.length && byName.length && !byNumber.some((project) => byName.some((named) => named.id === project.id))) {
    return { matches: [], conflict: true, warnings: [] };
  }
  let candidates = byNumber.length ? byNumber : byName;
  if (client && candidates.length) {
    const clientMatches = candidates.filter((project) => normaliseImportText(project.client_name) === client);
    if (clientMatches.length) candidates = clientMatches;
  }
  if (client && candidates.length && !candidates.some((project) => normaliseImportText(project.client_name) === client)) {
    warnings.push("Source client name does not match the candidate project's client; confirm this match before importing.");
  }
  if (inputNumber && !byNumber.length && candidates.length) warnings.push("Project number was not found in the linked project register; confirm the exact-name match before importing.");
  return { matches: candidates, warnings };
}

function staffMatches(row, context) {
  if (row.staffUserId) {
    const selected = context.staff.find((person) => person.id === row.staffUserId);
    return selected ? [selected] : [];
  }
  const query = normaliseImportText(row.staffName);
  if (!query) return [];
  return context.staff.filter((person) => normaliseImportText(person.name) === query || normaliseImportText(person.email) === query);
}

function projectCategories(project) {
  return [...new Set([
    ...(Array.isArray(project?.template?.category_options) ? project.template.category_options : []),
    ...(project?.allocations || []).filter((allocation) => allocation.status === "active" && allocation.staff_visible).map((allocation) => allocation.allocation_name),
  ].filter(Boolean))];
}

function findBudgetAllocations(project, workDate, category) {
  const sources = (project.sources || []).filter((source) =>
    source.approval_status === "approved" && ["original", "variation"].includes(source.source_type),
  );
  const hasMonthlySources = sources.some(hasBudgetPeriod);
  const dateSources = sources.filter((source) => budgetSourceMatchesDate(source, workDate) && (!hasMonthlySources || hasBudgetPeriod(source)));
  const choices = dateSources.flatMap((source) => (project.allocations || [])
    .filter((allocation) => allocation.budget_source_id === source.id && allocation.status === "active" && allocation.staff_visible)
    .map((allocation) => ({ source, allocation })));
  const matched = choices.filter(({ allocation }) => allocationMatchesCategory(allocation, category));
  if (matched.length) return matched;
  if (!hasMonthlySources && choices.length === 1) return choices;
  return [];
}

function issue(code, message) {
  return { code, message };
}

function normaliseRow(input, index) {
  const row = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const hoursValue = normaliseImportNumber(row.hours, { maximum: 24 });
  const kmValue = normaliseImportNumber(row.km, { allowBlank: true, maximum: 100000 });
  const expensesInput = cleanText(row.expenses, 100).replace(/^(?:AUD\s*)?\$\s*/i, "");
  const expensesValue = normaliseImportNumber(expensesInput, { allowBlank: true, maximum: 1000000 });
  return {
    sourceRow: Number.isInteger(Number(row.sourceRow)) && Number(row.sourceRow) > 0 ? Number(row.sourceRow) : index + 1,
    workDate: normaliseDateValue(row.workDate),
    staffName: cleanText(row.staffName, 160),
    staffUserId: validId(row.staffUserId) ? row.staffUserId : "",
    clientName: cleanText(row.clientName, 200),
    projectName: cleanText(row.projectName, 200),
    projectNumber: cleanText(row.projectNumber, 80),
    projectId: validId(row.projectId) ? row.projectId : "",
    budgetAllocationId: validId(row.budgetAllocationId) ? row.budgetAllocationId : "",
    hours: Number.isFinite(hoursValue) ? Math.round(hoursValue * 100) / 100 : null,
    expenses: expensesValue === null || Number.isFinite(expensesValue) ? expensesValue : cleanText(row.expenses, 100),
    invalidExpenses: !(expensesValue === null || Number.isFinite(expensesValue)),
    km: kmValue === null || Number.isFinite(kmValue) ? kmValue : cleanText(row.km, 100),
    vehicle: cleanText(row.vehicle, 120),
    invalidKm: !(kmValue === null || Number.isFinite(kmValue)),
    invalidHours: !Number.isFinite(hoursValue),
    activityCategory: cleanText(row.activityCategory, 120),
    sourceTask: cleanText(row.sourceTask ?? row.activityCategory, 120),
    comments: cleanText(row.comments, 5000),
    duplicateDecision: ["skip", "separate"].includes(row.duplicateDecision) ? row.duplicateDecision : "",
    duplicateReason: cleanText(row.duplicateReason, 1000),
    duplicateReviewToken: /^[a-f0-9]{64}$/.test(String(row.duplicateReviewToken || "")) ? row.duplicateReviewToken : "",
    previousChargeRate: row.chargeRate === undefined || row.chargeRate === null ? null : Number(row.chargeRate),
  };
}

async function findExistingDuplicates(admin, rows) {
  const existingEntries = [];
  if (!rows.length) return existingEntries;
  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  const staffIds = [...new Set(rows.map((row) => row.staffUserId))];
  const fromDate = timesheetWeekStart(rows.map((row) => row.workDate).sort()[0]);
  const toDate = timesheetWeekEnd(rows.map((row) => row.workDate).sort().at(-1));
  for (let start = 0; start < projectIds.length; start += 25) {
    const projectChunk = projectIds.slice(start, start + 25);
    let offset = 0;
    while (true) {
      const { data, error } = await admin.from("project_tracker_entries")
        .select("id, project_id, staff_user_id, entered_by_admin_id, work_date, activity_category, activity_information, hours, custom_data, updated_at")
        .in("project_id", projectChunk)
        .in("staff_user_id", staffIds)
        .gte("work_date", fromDate)
        .lte("work_date", toDate)
        .gt("hours", 0)
        .order("work_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const entries = data || [];
      existingEntries.push(...entries);
      if (entries.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (offset >= 50000) throw new Error("There is too much existing tracker history in this date range to check in one batch. Split the upload into smaller date ranges.");
    }
  }
  return existingEntries;
}

async function buildPreview(admin, inputRows, { forImport = false } = {}) {
  if (!Array.isArray(inputRows) || !inputRows.length) throw new Error("Map at least one timesheet row before previewing.");
  if (inputRows.length > MAX_IMPORT_ROWS) throw new Error(`Upload no more than ${MAX_IMPORT_ROWS} timesheet rows at a time.`);
  const context = await loadImportContext(admin);
  const rows = inputRows.map((input, index) => {
    const row = normaliseRow(input, index);
    const issues = [];
    const warnings = [];
    if (!row.workDate || !validBudgetDate(row.workDate)) issues.push(issue("invalid_date", "Enter a valid work date."));
    if (!row.staffName) issues.push(issue("missing_staff", "Staff name is required."));
    if (row.invalidHours || row.hours === null || row.hours <= 0) issues.push(issue("invalid_hours", "Hours must be a positive number no greater than 24."));
    if (row.invalidKm) issues.push(issue("invalid_km", "Kilometres must be a non-negative number, or left blank."));
    if (row.invalidExpenses) issues.push(issue("invalid_expenses", "Expenses must be a non-negative amount, or left blank. They are retained for reference, not charged."));
    if (!row.activityCategory) issues.push(issue("missing_category", "Activity category is required."));
    if (!row.projectName && !row.projectNumber && !row.projectId) issues.push(issue("missing_project", "Provide a project name or project number."));

    const projectResult = projectMatches(row, context);
    let project = projectResult.matches.length === 1 ? projectResult.matches[0] : null;
    if (projectResult.conflict) issues.push(issue("project_conflict", "The supplied project name and number point to different projects."));
    else if (!project) issues.push(issue(projectResult.matches.length ? "ambiguous_project" : "unmatched_project", projectResult.matches.length ? "More than one active project matches; choose the correct project." : "No active project matches this row; select the correct active project."));
    warnings.push(...projectResult.warnings);
    if (project) row.projectId = project.id;

    const matchingStaff = staffMatches(row, context);
    const staffPerson = matchingStaff.length === 1 ? matchingStaff[0] : null;
    if (!staffPerson) issues.push(issue(matchingStaff.length ? "ambiguous_staff" : "unmatched_staff", matchingStaff.length ? "More than one staff member matches; choose the correct person." : "No active staff account matches this name; select the correct person."));
    if (staffPerson) row.staffUserId = staffPerson.id;

    let resolvedCategory = row.activityCategory;
    let allocationChoice = null;
    row.allocationOptions = [];
    if (project && row.activityCategory) {
      const categories = projectCategories(project);
      const exactCategory = categories.find((value) => normaliseImportText(value) === normaliseImportText(row.activityCategory));
      if (exactCategory) resolvedCategory = exactCategory;
      else issues.push(issue("unmatched_category", "This category is not configured for the selected project; map it to a project category."));
      if (exactCategory && row.workDate && validBudgetDate(row.workDate)) {
        const choices = findBudgetAllocations(project, row.workDate, resolvedCategory);
        row.allocationOptions = choices.map(({ source, allocation }) => ({ id: allocation.id, sourceId: source.id, label: `${source.source_name} · ${allocation.allocation_name}${source.service_period_start ? ` · ${source.service_period_start} to ${source.service_period_end}` : ""}` }));
        allocationChoice = row.budgetAllocationId ? choices.find(({ allocation }) => allocation.id === row.budgetAllocationId) : choices.length === 1 ? choices[0] : null;
        if (!allocationChoice) issues.push(issue(choices.length > 1 ? "ambiguous_budget_allocation" : "no_budget_allocation", choices.length > 1 ? "More than one approved budget allocation matches; choose the source/allocation to charge." : "No approved, active allocation matches this project, work date and category."));
      }
    }
    if (allocationChoice) {
      row.budgetSourceId = allocationChoice.source.id;
      row.budgetAllocationId = allocationChoice.allocation.id;
    }
    row.activityCategory = resolvedCategory;
    row.projectLabel = project?.name || row.projectName || row.projectNumber || "Unmatched project";
    row.staffLabel = staffPerson?.name || row.staffName || "Unmatched staff";
    row.categoryOptions = project ? projectCategories(project) : [];
    row.chargeRole = staffPerson ? trackerChargeRole(staffPerson.id) : "";
    const projectRates = project ? context.rateByProject.get(project.id) : null;
    row.chargeRate = projectRates?.get(row.chargeRole) ?? null;
    row.chargeAmount = row.chargeRate === null || row.hours === null ? null : Math.round(row.hours * row.chargeRate * 100) / 100;
    if (project && staffPerson && !(Number(row.chargeRate) > 0)) issues.push(issue("missing_project_rates", "Confirm this job's Charge-out Rates in Project Operations before importing. Company defaults are suggestions only."));
    if (forImport && row.previousChargeRate !== null && row.chargeRate !== row.previousChargeRate) issues.push(issue("project_rate_changed", "This job's charge rate changed since preview. Refresh and review the labour charge before importing."));
    row.issues = issues;
    row.warnings = warnings;
    row.isImportable = issues.length === 0;
    return row;
  });

  if (new Set(rows.map((row) => row.sourceRow)).size !== rows.length) throw new Error("Each uploaded row must have a distinct source row number.");
  const eligibleForDuplicateCheck = rows.filter((row) => row.projectId && row.staffUserId && row.workDate && validBudgetDate(row.workDate));
  const existingEntries = await findExistingDuplicates(admin, eligibleForDuplicateCheck);
  const { reconciliation } = reconcileTimesheetRows(rows, existingEntries);

  const summary = {
    total: rows.length,
    ready: rows.filter((row) => row.isImportable).length,
    duplicates: rows.filter((row) => row.issues.some((item) => item.code.startsWith("duplicate_"))).length,
    needsReview: rows.filter((row) => !row.isImportable && !row.issues.some((item) => item.code.startsWith("duplicate_"))).length,
    possibleDuplicates: rows.filter((row) => row.possibleDuplicates.length || row.fileOverlaps.length).length,
    excluded: rows.filter((row) => row.isSkipped).length,
    unresolved: rows.filter((row) => !row.isImportable && !row.isSkipped).length,
    totalHours: Math.round(rows.filter((row) => row.isImportable).reduce((sum, row) => sum + row.hours, 0) * 100) / 100,
    totalKm: Math.round(rows.filter((row) => row.isImportable && row.km != null).reduce((sum, row) => sum + row.km, 0) * 100) / 100,
    totalCharge: Math.round(rows.filter((row) => row.isImportable).reduce((sum, row) => sum + Number(row.chargeAmount || 0), 0) * 100) / 100,
  };
  return { rows, summary, reconciliation, projectOptions: context.projectOptions, staffOptions: context.staffOptions };
}

async function handleUpload(request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return jsonError("Choose a CSV or Excel timesheet file.");
  if (!/\.(csv|xlsx|xls)$/i.test(String(file.name || ""))) return jsonError("Choose a .csv, .xlsx or .xls timesheet file.");
  if (file.size > MAX_FILE_BYTES) return jsonError("The upload must be 10 MB or smaller.", 413);
  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true, dense: false, raw: /\.csv$/i.test(String(file.name || "")) });
  } catch {
    return jsonError("This file could not be read as a CSV or Excel workbook.");
  }
  const sheetName = workbook.SheetNames?.[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet || !sheet["!ref"]) return jsonError("The first worksheet is empty.");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  if (range.e.r - range.s.r + 1 > MAX_IMPORT_ROWS + 20 || range.e.c - range.s.c + 1 > MAX_IMPORT_COLUMNS) {
    return jsonError(`The first worksheet must contain no more than ${MAX_IMPORT_ROWS} data rows and ${MAX_IMPORT_COLUMNS} columns.`, 413);
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  let headerIndex = -1;
  let fallbackHeaderIndex = -1;
  let bestHeaderScore = 0;
  for (let index = 0; index < Math.min(matrix.length, 20); index += 1) {
    const candidate = matrix[index] || [];
    const nonEmpty = candidate.filter((cell) => String(cell ?? "").trim()).length;
    if (nonEmpty >= 2 && fallbackHeaderIndex < 0) fallbackHeaderIndex = index;
    if (nonEmpty < 2) continue;
    const inferred = inferTimesheetColumnMap(candidate.map((cell) => String(cell ?? "")));
    const score = Object.values(inferred).filter((columnIndex) => columnIndex !== "").length;
    if (score > bestHeaderScore) {
      bestHeaderScore = score;
      headerIndex = index;
    }
    if (inferred.workDate !== "" && inferred.staffName !== "" && inferred.hours !== "") break;
  }
  if (headerIndex < 0) headerIndex = fallbackHeaderIndex;
  if (headerIndex < 0) return jsonError("Could not find a header row with at least two column names.");
  const rawHeaders = matrix[headerIndex] || [];
  const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => {
    const value = String(rawHeaders[index] ?? "").trim();
    return value || `Column ${index + 1}`;
  });
  const rawRows = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const values = matrix[index] || [];
    if (!values.some((cell) => String(cell ?? "").trim())) continue;
    rawRows.push({ rowNumber: index + 1, values: values.slice(0, headers.length).map((value) => value instanceof Date ? value.toISOString().slice(0, 10) : value) });
    if (rawRows.length > MAX_IMPORT_ROWS) return jsonError(`Upload no more than ${MAX_IMPORT_ROWS} timesheet rows at a time.`, 413);
  }
  if (!rawRows.length) return jsonError("The worksheet contains no timesheet rows below its header.");
  return Response.json({ fileName: safeFileName(file.name), sheetName, headers, rawRows }, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
}

async function handleImport(access, body) {
  const fileName = safeFileName(body.fileName);
  const preview = await buildPreview(access.admin, body.rows, { forImport: true });
  const blocked = preview.rows.filter((row) => !row.isImportable && !row.isSkipped);
  const included = preview.rows.filter((row) => row.isImportable);
  if (blocked.length || !included.length) {
    return jsonError("One or more selected rows need review or are duplicates. Refresh the preview before importing.", 409, { preview });
  }
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const entries = included.map((row) => ({
    project_id: row.projectId,
    budget_source_id: row.budgetSourceId,
    budget_allocation_id: row.budgetAllocationId,
    staff_user_id: row.staffUserId,
    entered_by_admin_id: access.user.id,
    work_date: row.workDate,
    activity_category: row.activityCategory,
    activity_information: row.comments || "Imported weekly timesheet entry — no comments supplied.",
    hours: row.hours,
    status: "completed",
    notable_issues: null,
    custom_data: {
      ...(row.km === null ? {} : { km: row.km }),
      expenses: row.expenses,
      vehicle: row.vehicle,
      import_source_task: row.sourceTask,
      import_expected_charge_rate: row.chargeRate,
      import_charge_role: row.chargeRole,
      import_duplicate_review: {
        decision: row.duplicateDecision === "separate" ? "separate" : "new",
        reason: row.duplicateReason || null,
        review_token: row.duplicateReviewToken || null,
        expected_entries: row.reviewExpectedEntries,
        file_overlap_rows: row.fileOverlaps.map((peer) => peer.sourceRow),
      },
      import_fingerprint: createHash("sha256").update(timesheetDuplicateKey(row)).digest("hex"),
      import_batch_id: batchId,
      import_file_name: fileName,
      import_source_row: row.sourceRow,
      import_source_project_number: row.projectNumber || null,
      import_source_client: row.clientName || null,
    },
    created_at: now,
    updated_at: now,
  }));
  const { data: result, error: importError } = await access.admin.rpc("ec_import_weekly_timesheets_reviewed", {
    p_actor_id: access.user.id,
    p_batch_id: batchId,
    p_entries: entries,
  });
  if (importError) {
    const migrationPending = ["42883", "PGRST202"].includes(importError.code);
    if (migrationPending) return jsonError("The atomic timesheet-import migration is not available. No entries were imported.", 409);
    if (["23505", "40001"].includes(importError.code)) {
      const refreshed = await buildPreview(access.admin, body.rows);
      return jsonError("The data changed or identical entries were imported by another administrator. Review the refreshed preview; this batch was not imported.", 409, { preview: refreshed });
    }
    console.error("Atomic weekly timesheet import failed:", importError.code, importError.message);
    return jsonError("The import could not be committed. No entries, totals or notifications from this batch were saved.", 500);
  }
  if (!result?.success || result.importedCount !== entries.length) return jsonError("The import response could not be verified. Reload the tracker before retrying.", 502);
  return Response.json({ ...result, skippedCount: preview.summary.excluded }, { status: 201, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
}

export async function POST(request) {
  const access = await requireSession(request);
  if (access.error) return access.error;
  if (!access.isAdmin) return jsonError("Administrator access is required.", 403);
  try {
    const denied = await requirePortalResource(access, "admin.projects.tracker");
    if (denied) return denied;
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) return await handleUpload(request);
    const body = await request.json();
    if (body?.action === "preview") {
      const preview = await buildPreview(access.admin, body.rows);
      return Response.json(preview, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
    }
    if (body?.action === "import") return await handleImport(access, body);
    return jsonError("Choose upload, preview, or import.");
  } catch (error) {
    return serverError(error);
  }
}
