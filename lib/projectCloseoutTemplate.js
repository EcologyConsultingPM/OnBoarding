/**
 * Shared browser/server Project Close Report contract. No dependencies or side effects.
 * Unknown JSON keys are consistently discarded at the report and row levels.
 * Missing fields receive template defaults; explicitly invalid values always throw.
 * Numeric fields are stored as decimal strings (or ''), preserving entered precision.
 */
const TEXT_LIMIT = 5000;
const STATUSES = ['Open', 'In progress', 'Complete'];
const TEXT_FIELDS = ['name', 'number', 'client', 'closedBy', 'approvedBy'];
const DATE_FIELDS = ['start', 'end', 'closeDate'];
const LISTS = {
  deliverables: { cap: 100, count: 3, fields: { title: 'text', budget: 'number', hrs: 'number', actual: 'number' } },
  seniors: { cap: 3, count: 1, fields: { name: 'text', role: 'text' } },
  ecologists: { cap: 10, count: 2, fields: { name: 'text', role: 'text' } },
  hurdles: { cap: 100, count: 1, fields: { hurdle: 'text', impact: 'text', resolution: 'text' } },
  lessons: { cap: 100, count: 1, fields: { lesson: 'text', action: 'text', owner: 'text', due: 'date', status: 'status' } },
};
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function objectValue(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${path} must be a JSON object.`);
  }
  return value;
}

function textValue(value, path) {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  if (value.length > TEXT_LIMIT) throw new Error(`${path} must not exceed ${TEXT_LIMIT} characters.`);
  return value;
}

function dateValue(value, path) {
  const text = textValue(value, path);
  if (text === '') return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000-')) {
    throw new Error(`${path} must be a real ISO date (YYYY-MM-DD) or blank.`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${path} must be a real ISO date (YYYY-MM-DD) or blank.`);
  }
  return text;
}

// Expand finite JavaScript numbers so that normalising our own output is idempotent.
function decimalString(number) {
  const text = String(number);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponent] = text.toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function numberValue(value, path) {
  if (value === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${path} must be a finite decimal of zero or greater, or blank.`);
    return decimalString(value);
  }
  const text = textValue(value, path);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) {
    throw new Error(`${path} must be a finite decimal of zero or greater, or blank.`);
  }
  return text;
}

function blankRow(fields) {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, key === 'status' ? 'Open' : '']));
}

function normaliseRows(value, key) {
  const definition = LISTS[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`);
  if (value.length > definition.cap) throw new Error(`${key} must not exceed ${definition.cap} rows.`);
  // Array.from also visits sparse slots, which must not bypass row validation.
  return Array.from(value, (row, index) => {
    const path = `${key}[${index}]`;
    objectValue(row, path);
    return Object.fromEntries(Object.entries(definition.fields).map(([field, type]) => {
      const fieldPath = `${path}.${field}`;
      const input = own(row, field) ? row[field] : (type === 'status' ? 'Open' : '');
      let result;
      if (type === 'date') result = dateValue(input, fieldPath);
      else if (type === 'number') result = numberValue(input, fieldPath);
      else {
        result = textValue(input, fieldPath);
        if (type === 'status' && !STATUSES.includes(result)) {
          throw new Error(`${fieldPath} must be Open, In progress or Complete.`);
        }
      }
      return [field, result];
    }));
  });
}

function projectDefaults(project) {
  objectValue(project, 'project');
  // The actual projects schema has no project number. In particular, never use id.
  const prefill = (key) => project[key] === null || project[key] === undefined ? '' : project[key];
  return {
    name: prefill('name'), number: '', client: prefill('client_name'),
    start: prefill('start_date'), end: prefill('end_date'),
    closedBy: '', approvedBy: '', closeDate: '',
  };
}

/** Make independent blank rows, with only confirmed project columns prefilled. */
export function createCloseoutReport(project = {}) {
  return normaliseCloseoutReport({}, project);
}

/** Validate drafts too: no coercion of objects/null/booleans, slicing or silent repair. */
export function normaliseCloseoutReport(report, project = {}) {
  objectValue(report, 'report');
  const defaults = projectDefaults(project);
  const result = {};
  for (const key of TEXT_FIELDS) result[key] = textValue(own(report, key) ? report[key] : defaults[key], key);
  for (const key of DATE_FIELDS) result[key] = dateValue(own(report, key) ? report[key] : defaults[key], key);
  for (const [key, definition] of Object.entries(LISTS)) {
    result[key] = normaliseRows(own(report, key) ? report[key]
      : Array.from({ length: definition.count }, () => blankRow(definition.fields)), key);
  }
  if (result.start && result.end && result.end < result.start) {
    throw new Error('Final date must be on or after the start date.');
  }
  if (result.closeDate && ((result.start && result.closeDate < result.start) || (result.end && result.closeDate < result.end))) {
    throw new Error('Close-out date must be on or after the project start and final dates.');
  }
  return result;
}

// Exact decimal accumulation avoids familiar 0.1 + 0.2 artefacts. The public totals
// are numbers; a sum that cannot be represented as finite is rejected explicitly.
function decimalParts(value) {
  const [whole = '', fraction = ''] = (value || '0').split('.');
  return { units: BigInt((whole || '0') + fraction), scale: fraction.length };
}

function decimalTotal(values) {
  const parts = values.map(([value, sign = 1]) => ({ ...decimalParts(value), sign }));
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const units = parts.reduce((sum, part) => sum + BigInt(part.sign) * part.units * (10n ** BigInt(scale - part.scale)), 0n);
  const sign = units < 0n ? '-' : '';
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const number = Number(sign + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits));
  if (!Number.isFinite(number)) throw new Error('Report totals exceed the finite numeric range.');
  return number === 0 ? 0 : number;
}

/** Inclusive calendar-day duration, as in the template; blank dates yield zero. */
export function closeoutTotals(report) {
  const value = normaliseCloseoutReport(report);
  const pairs = (field) => value.deliverables.map((row) => [row[field], 1]);
  return {
    budget: decimalTotal(pairs('budget')),
    budgetHours: decimalTotal(pairs('hrs')),
    actualHours: decimalTotal(pairs('actual')),
    variance: decimalTotal([...pairs('actual'), ...value.deliverables.map((row) => [row.hrs, -1])]),
    durationDays: value.start && value.end ? (Date.parse(`${value.end}T00:00:00Z`) - Date.parse(`${value.start}T00:00:00Z`)) / 86400000 + 1 : 0,
  };
}

/** Submission requirements only; unfinished lessons remain valid and visible. */
export function validateCloseoutSubmission(report) {
  let value;
  try {
    value = normaliseCloseoutReport(report);
    closeoutTotals(value);
  } catch (error) {
    return [error.message];
  }
  const errors = [];
  for (const [key, label] of [['name', 'Project name'], ['closedBy', 'Closed out by'], ['approvedBy', 'Approved by'], ['closeDate', 'Close-out date']]) {
    if (!value[key].trim()) errors.push(`${label} is required.`);
  }
  if (!value.deliverables.some((row) => row.title.trim())) errors.push('At least one deliverable title is required.');
  return errors;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function printable(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

const shown = (value) => escapeHtml(printable(value));
const numberDisplay = (number) => number.toLocaleString('en-AU', { maximumFractionDigits: 20 });
const signed = (number) => `${number > 0 ? '+' : ''}${numberDisplay(number)}`;
const currency = (number) => `$${number.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 20 })}`;

function descriptionList(entries) {
  return `<dl class="details">${entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${shown(value)}</dd></div>`).join('')}</dl>`;
}

function table(caption, headers, rows, footer = '') {
  return `<div class="table-scroll" role="region" tabindex="0" aria-label="${escapeHtml(caption)}"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((heading) => `<th scope="col">${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${shown(cell)}</th>` : `<td>${shown(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">No entries recorded.</td></tr>`}</tbody>${footer}</table></div>`;
}

function hurdleTable(rows, caption = 'Project hurdles') {
  return table(caption, ['Hurdle', 'Impact', 'How it was resolved'], rows.map((row) => [row.hurdle, row.impact, row.resolution]));
}

function lessonTable(rows, caption = 'Lessons learnt and actions') {
  return table(caption, ['Lesson learnt', 'Action', 'Owner', 'Due', 'Status'], rows.map((row) => [row.lesson, row.action, row.owner, row.due, row.status]));
}

function unfinishedNote(rows) {
  const count = rows.filter((row) => row.status !== 'Complete' && ['lesson', 'action', 'owner', 'due'].some((key) => row[key].trim())).length;
  return `<p class="notice">${count} unfinished lesson${count === 1 ? '' : 's'} / action${count === 1 ? '' : 's'}. Open and in-progress actions are retained; report submission does not mark them complete.</p>`;
}

function numberedSection(number, id, title, subtitle, content) {
  return `<section class="card" aria-labelledby="${id}"><header class="section-header"><span class="section-number" aria-hidden="true">${number}</span><div><h2 id="${id}">${title}</h2><p>${subtitle}</p></div></header><div class="card-body">${content}</div></section>`;
}

function personName(entry) {
  const candidates = [entry.staff_name, entry.staff_user_name, entry.name, entry.display_name, entry.person_name, entry.user_name,
    entry.staff?.name, entry.staff?.full_name, entry.person?.name, entry.profile?.full_name, entry.user?.name, entry.user?.full_name];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || entry.staff_user_id || 'Unidentified team member';
}

function renderFeedback(feedback) {
  if (!Array.isArray(feedback)) throw new Error('feedback must be an array.');
  return `<section class="card" aria-labelledby="team-responses"><div class="card-body"><h2 id="team-responses">Project Team Responses</h2><p>Individual responses are retained separately from the master report. Draft and submitted states are shown as recorded.</p>${feedback.length ? feedback.map((entry, index) => {
    objectValue(entry, `feedback[${index}]`);
    const response = entry.response ?? {};
    let content;
    if (typeof response === 'string') content = `<h4>Legacy response</h4><p class="preserve">${shown(response)}</p>`;
    else {
      objectValue(response, `feedback[${index}].response`);
      const hurdles = normaliseRows(own(response, 'hurdles') ? response.hurdles : [], 'hurdles');
      const lessons = normaliseRows(own(response, 'lessons') ? response.lessons : [], 'lessons');
      const legacy = Object.entries(response).filter(([key]) => !['hurdles', 'lessons'].includes(key));
      content = hurdleTable(hurdles, `Response ${index + 1}: hurdles`) + lessonTable(lessons, `Response ${index + 1}: lessons learnt and actions`) + unfinishedNote(lessons)
        + (legacy.length ? `<h4>Legacy response notes</h4>${descriptionList(legacy)}` : '');
    }
    return `<article class="team-response" aria-labelledby="response-${index + 1}"><h3 id="response-${index + 1}">${escapeHtml(personName(entry))}</h3>${descriptionList([
      ['Staff user ID', entry.staff_user_id], ['Response status', entry.status || 'Not recorded'],
      ['Submitted at', entry.submitted_at], ['Created at', entry.created_at], ['Updated at', entry.updated_at],
      ...['id', 'invitation_id', 'review_round', 'report_revision', 'locked_at'].filter((key) => own(entry, key)).map((key) => [key.replaceAll('_', ' '), entry[key]]),
    ])}${content}</article>`;
  }).join('') : '<p>No team responses supplied.</p>'}</div></section>`;
}

const METADATA_FIELDS = [
  ['id', 'Close-out ID'], ['status', 'Close-out state'], ['report_revision', 'Report revision'],
  ['export_note', 'Export note'], ['review_round', 'Review round'],
  ['created_at', 'Created at'], ['created_by', 'Created by'], ['updated_at', 'Updated at'], ['updated_by', 'Updated by'],
  ['initiated_at', 'Initiated at'], ['initiated_by', 'Initiated by'], ['submitted_at', 'Submitted at'], ['submitted_by', 'Submitted by'],
  ['approved_at', 'Approved at'], ['approved_by', 'Approved by'], ['locked_at', 'Locked at'], ['locked_by', 'Locked by'],
  ['reopened_at', 'Reopened at'], ['reopened_by', 'Reopened by'], ['reopen_reason', 'Reopen reason'],
  ['archived_at', 'Archived at'], ['archived_by', 'Archived by'],
  ['override_reason', 'Override reason'], ['override_at', 'Override time'], ['override_by', 'Override actor'],
];
const LEGACY_FIELDS = [
  ['success_score', 'Success score'], ['client_outcome', 'Client outcome'], ['delivery_summary', 'Delivery summary'],
  ['lessons_learned', 'Lessons learned (legacy)'], ['stakeholder_feedback', 'Stakeholder feedback'],
  ['financial_review_notes', 'Financial review notes'], ['recommendations', 'Recommendations'], ['approval_note', 'Approval note'],
];

// All CSS is fixed developer-authored text. No user value ever enters CSS, a URL,
// raw markup, a script or an event handler. Text and attribute contexts are escaped.
const EXPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #f4f4ee; color: #23301f; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; }
.report-header { padding: 42px 24px; color: #fdfdf8; background: linear-gradient(140deg, #16371f 0%, #24522a 38%, #3d7a35 72%, #6ea24f 100%); }
.header-inner, main, .report-footer { max-width: 1120px; margin: 0 auto; }
.brand, .eyebrow { font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.brand { font-size: 14px; color: #e6efd8; }
h1 { font-size: clamp(26px, 5vw, 42px); margin: 8px 0 24px; line-height: 1.2; overflow-wrap: anywhere; white-space: pre-wrap; }
h2 { margin: 0; font-size: 21px; line-height: 1.35; }
h3 { margin: 18px 0 8px; font-size: 17px; }
h4 { margin-bottom: 8px; }
p { margin: 8px 0 14px; }
main { padding: 28px 24px 40px; display: grid; gap: 24px; }
.details, .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 12px; margin: 14px 0; }
.details > div, .metric { padding: 12px 14px; background: #fafbf4; border: 1px solid #dfe2d3; border-radius: 9px; min-width: 0; }
dt, .metric-label { font-size: 12px; font-weight: 800; color: #35692f; letter-spacing: .04em; }
dd { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.report-header .details { color: #23301f; }
.summary-grid { margin: 12px 0 0; }
.metric { background: #fff; }
.metric-value { font-size: 23px; font-weight: 800; overflow-wrap: anywhere; }
.card { min-width: 0; background: #fff; border: 1px solid #e3e6d8; border-radius: 14px; box-shadow: 0 2px 10px #23301f0d; }
.section-header { display: flex; align-items: center; gap: 14px; padding: 18px 22px; border-radius: 13px 13px 0 0; color: #fdfdf8; background: linear-gradient(120deg, #1e4d2b 0%, #35692f 55%, #5b8f45 100%); }
.section-header p { color: #e6efd8; margin: 3px 0 0; font-size: 13px; font-style: italic; }
.section-number { border-radius: 9px; padding: 7px 10px; background: #ffffff26; font-weight: 800; }
.card-body { padding: 18px 22px; min-width: 0; }
.table-scroll { overflow-x: auto; margin: 12px 0; border: 1px solid #dfe2d3; border-radius: 8px; }
.table-scroll:focus { outline: 3px solid #35692f; outline-offset: 3px; }
table { width: 100%; min-width: 650px; table-layout: fixed; border-collapse: collapse; font-size: 14px; }
caption { text-align: left; padding: 10px; font-weight: 800; color: #35692f; background: #eef3e4; }
th, td { padding: 10px; text-align: left; vertical-align: top; border-bottom: 1px solid #e3e6d8; white-space: pre-wrap; overflow-wrap: anywhere; }
thead th { font-size: 12px; background: #fafbf4; color: #35692f; }
#deliverables + p { margin-top: 3px; }
[aria-label="Deliverables, budget and hours"] thead th:first-child { width: 5%; }
[aria-label="Deliverables, budget and hours"] thead th:nth-child(2) { width: 35%; }
[aria-label="Deliverables, budget and hours"] thead th:nth-child(n+3) { width: 15%; }
tbody th { font-weight: 600; }
tfoot th, tfoot td { background: #eef3e4; font-weight: 800; }
.team-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 22px; }
.team-grid table { min-width: 320px; }
.notice { padding: 12px; border-left: 4px solid #6e8c50; background: #eef3e4; }
.signoff { background: linear-gradient(100deg, #eef3e4, #f8f9f1 70%); }
.team-response { border-top: 2px solid #dfe2d3; margin-top: 24px; padding-top: 4px; }
.preserve { white-space: pre-wrap; overflow-wrap: anywhere; }
.report-footer { padding: 0 24px 28px; color: #4f5c45; text-align: center; font-size: 13px; }
@page { size: A4; margin: 14mm; }
@media (max-width: 600px) { main { padding: 18px 12px; gap: 18px; } .card-body { padding: 14px; } .section-header { padding: 16px 14px; } }
@media print {
  html, body { background: #fff; font-size: 10pt; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-header { padding: 18px; }
  h1 { font-size: 25pt; }
  main { display: block; padding: 0; max-width: none; }
  .card, .summary { margin: 16px 0; border-radius: 0; box-shadow: none; break-inside: auto; }
  .section-header { border-radius: 0; break-inside: avoid; break-after: avoid; }
  h2, h3, h4, caption { break-after: avoid; }
  .card-body { padding: 10px; }
  .table-scroll { overflow: visible; border-radius: 0; }
  table, .team-grid table { min-width: 0; width: 100%; font-size: 9pt; }
  th, td { padding: 6px; }
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .team-grid { display: block; }
  .signoff, .details > div, .metric { break-inside: avoid; }
  p { orphans: 3; widows: 3; }
}
`;

/** Complete offline, read-only document. Caller must authorise which feedback is supplied. */
export function renderCloseoutHtml({ report, closeout = null, feedback = [], project = {} } = {}) {
  const record = closeout === null ? {} : objectValue(closeout, 'closeout');
  const value = normaliseCloseoutReport(report === undefined ? (record.report_data ?? {}) : report, project);
  const totals = closeoutTotals(value);
  const duration = value.start && value.end ? `${totals.durationDays} day${totals.durationDays === 1 ? '' : 's'} (inclusive)` : 'Not recorded';
  const metadata = [
    ['Project ID', project.id], ['Project state', project.status], ['Project lead user ID', project.project_lead_user_id],
    ['Close-out state', record.status || 'Draft'], ['Report revision', record.report_revision ?? 0],
    ['Editing state', record.locked_at || record.locked === true || ['closed', 'archived'].includes(record.status) ? 'Locked' : 'Draft / unlocked'],
    ...METADATA_FIELDS.filter(([key]) => !['status', 'report_revision'].includes(key) && own(record, key)).map(([key, label]) => [label, record[key]]),
  ];
  const legacy = LEGACY_FIELDS.filter(([key]) => own(record, key) && record[key] !== null && record[key] !== '').map(([key, label]) => [label, record[key]]);
  const audit = ['audit', 'audit_log', 'history'].filter((key) => own(record, key) && record[key] !== null).map((key) => `<h3>${escapeHtml(key === 'history' ? 'History' : 'Audit history')}</h3><pre class="preserve">${shown(record[key])}</pre>`).join('');
  const footer = `<tfoot><tr><th scope="row" colspan="2">Total</th><td>${escapeHtml(currency(totals.budget))}</td><td>${escapeHtml(numberDisplay(totals.budgetHours))}</td><td>${escapeHtml(numberDisplay(totals.actualHours))}</td><td>${escapeHtml(signed(totals.variance))}</td></tr></tfoot>`;
  const deliverables = table('Deliverables, budget and hours', ['#', 'Deliverable', 'Budget ($)', 'Budget hrs', 'Actual hrs', 'Variance'], value.deliverables.map((row, index) => [
    index + 1, row.title, row.budget, row.hrs, row.actual,
    row.hrs !== '' && row.actual !== '' ? signed(decimalTotal([[row.actual, 1], [row.hrs, -1]])) : '—',
  ]), footer);
  const team = `<div class="team-grid"><div><h3>Overseeing Senior Ecologist(s)</h3>${table('Overseeing senior ecologists', ['Name', 'Specialty'], value.seniors.map((row) => [row.name, row.role]))}</div><div><h3>Ecologists</h3>${table('Ecologists', ['Name', 'Role on project'], value.ecologists.map((row) => [row.name, row.role]))}</div></div>`;
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(value.name || 'Untitled project')} — Project Close Report</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<header class="report-header"><div class="header-inner"><div class="brand">Ecology Consulting</div><p class="eyebrow">Project Close Report</p><h1>${escapeHtml(value.name || 'Untitled project')}</h1>${descriptionList([
    ['Project number', value.number], ['Client', value.client], ['Start date', value.start], ['Final date', value.end],
  ])}</div></header>
<main>
<section class="summary" aria-labelledby="summary"><h2 id="summary">Summary</h2><div class="summary-grid">${[
    ['Duration', duration], ['Total budget', currency(totals.budget)],
    ['Hours — budget / actual', `${numberDisplay(totals.budgetHours)} / ${numberDisplay(totals.actualHours)}`],
    ['Hours variance', `${signed(totals.variance)} hrs`],
  ].map(([label, result]) => `<div class="metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(result)}</div></div>`).join('')}</div></section>
${numberedSection('01', 'deliverables', 'Deliverables, Budget &amp; Hours', 'To be completed by the Project Manager', deliverables)}
${numberedSection('02', 'project-team', 'Project Team', 'To be completed by the Project Manager', team)}
${numberedSection('03', 'hurdles', 'Project Hurdles', 'To be completed by the Senior Ecologist(s) and Ecologists', hurdleTable(value.hurdles))}
${numberedSection('04', 'lessons', 'Lessons Learnt &amp; Actions', 'To be completed by the Senior Ecologist(s) and Ecologists', lessonTable(value.lessons) + unfinishedNote(value.lessons))}
<section class="card signoff" aria-labelledby="signoff"><div class="card-body"><h2 id="signoff">Sign-off</h2>${descriptionList([['Closed out by', value.closedBy], ['Approved by', value.approvedBy], ['Close-out date', value.closeDate]])}</div></section>
<section class="card" aria-labelledby="metadata"><div class="card-body"><h2 id="metadata">Report Metadata &amp; Audit</h2>${descriptionList(metadata)}${record.override_reason || record.override_at || record.override_by ? '<p class="notice">Administrative override recorded. Template completion and outstanding team reviews may have been bypassed. All supplied drafts and responses are retained below.</p>' : ''}${audit}</div></section>
${legacy.length ? `<section class="card" aria-labelledby="legacy"><div class="card-body"><h2 id="legacy">Legacy Close-out Notes</h2>${descriptionList(legacy)}</div></section>` : ''}
${renderFeedback(feedback)}
</main>
<footer class="report-footer">Ecology Consulting — Project Close Report · Static offline copy · Use your browser’s Print command to save as PDF. No changes are saved from this copy.</footer>
</body>
</html>`;
}
