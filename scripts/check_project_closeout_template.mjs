#!/usr/bin/env node
/** Run: node scripts/check_project_closeout_template.mjs (no package type change needed). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../lib/projectCloseoutTemplate.js', import.meta.url), 'utf8');
const {
  createCloseoutReport, normaliseCloseoutReport, closeoutTotals,
  validateCloseoutSubmission, renderCloseoutHtml,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let passed = 0;
function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const validReport = () => ({
  ...createCloseoutReport(), name: 'Wetland restoration', number: 'EC-2026-041', client: 'Catchment Council',
  start: '2026-01-01', end: '2026-01-31', closedBy: 'Project Manager', approvedBy: 'Administrator', closeDate: '2026-02-01',
  deliverables: [{ title: 'Final report', budget: '1000.25', hrs: '10.5', actual: '12.75' }],
});
const listDefinitions = {
  deliverables: { cap: 100, row: { title: '', budget: '', hrs: '', actual: '' } },
  seniors: { cap: 3, row: { name: '', role: '' } },
  ecologists: { cap: 10, row: { name: '', role: '' } },
  hurdles: { cap: 100, row: { hurdle: '', impact: '', resolution: '' } },
  lessons: { cap: 100, row: { lesson: '', action: '', owner: '', due: '', status: 'Open' } },
};

function textContent(html) {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function assertStandalone(html) {
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en-AU">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<main>/);
  assert.match(html, /<\/body>\s*<\/html>$/);
  assert.doesNotMatch(html, /<(?:script|link|iframe|object|embed|img|video|audio|source|input|textarea|button|form)\b/i);
  assert.doesNotMatch(html, /\s(?:src|href|srcset|on\w+)\s*=/i);
  assert.doesNotMatch(html, /(?:url\s*\(|@import\b|@font-face\b)/i);
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.equal((html.match(/<\/style>/g) || []).length, 1);
}

test('exports precisely the five shared APIs without dependencies', () => {
  for (const fn of [createCloseoutReport, normaliseCloseoutReport, closeoutTotals, validateCloseoutSubmission, renderCloseoutHtml]) assert.equal(typeof fn, 'function');
  assert.doesNotMatch(source, /^\s*import\s/m);
});

test('template defaults have the exact report fields and blank row counts', () => {
  const report = createCloseoutReport();
  assert.deepEqual(Object.keys(report).sort(), ['name', 'number', 'client', 'start', 'end', 'closedBy', 'approvedBy', 'closeDate', ...Object.keys(listDefinitions)].sort());
  for (const key of ['name', 'number', 'client', 'start', 'end', 'closedBy', 'approvedBy', 'closeDate']) assert.equal(report[key], '');
  for (const [list, count] of Object.entries({ deliverables: 3, seniors: 1, ecologists: 2, hurdles: 1, lessons: 1 })) {
    assert.equal(report[list].length, count);
    for (const row of report[list]) assert.deepEqual(row, listDefinitions[list].row);
  }
  report.deliverables[0].title = 'Changed';
  report.ecologists[0].name = 'Changed';
  assert.equal(report.deliverables[1].title, '');
  assert.equal(report.ecologists[1].name, '');
  assert.equal(createCloseoutReport().deliverables[0].title, '');
});

test('prefills only confirmed project fields and never guesses a project number from its ID', () => {
  const project = { id: 'internal-uuid', name: 'Project name', client_name: 'Client', start_date: '2024-02-29', end_date: '2024-03-01', project_number: 'not-in-schema', client: 'wrong alias' };
  const report = createCloseoutReport(project);
  assert.equal(report.name, project.name);
  assert.equal(report.client, project.client_name);
  assert.equal(report.start, project.start_date);
  assert.equal(report.end, project.end_date);
  assert.equal(report.number, '');
  assert.equal(report.closedBy, '');
  assert.equal(createCloseoutReport({ name: null, client_name: null, start_date: null, end_date: null }).name, '');
  assert.equal(normaliseCloseoutReport({ name: '' }, project).name, '');
  assert.equal(normaliseCloseoutReport({}, project).name, project.name);
});

test('normalisation is independent, idempotent and consistently discards unknown keys', () => {
  const input = validReport();
  input.extra = { anything: true };
  input.deliverables[0].unknown = 'ignored';
  input.seniors[0].unknown = 'ignored';
  input.lessons[0].unknown = 'ignored';
  input.deliverables[0].actual = 12.75;
  const before = clone(input);
  const report = normaliseCloseoutReport(input);
  assert.deepEqual(input, before);
  assert.equal(report.extra, undefined);
  assert.equal(report.deliverables[0].unknown, undefined);
  assert.equal(report.seniors[0].unknown, undefined);
  assert.equal(report.lessons[0].unknown, undefined);
  assert.equal(report.deliverables[0].actual, '12.75');
  assert.deepEqual(normaliseCloseoutReport(report), report);
  const dangerous = JSON.parse('{"__proto__":{"polluted":true},"constructor":"discard"}');
  assert.equal(normaliseCloseoutReport(dangerous).constructor, Object);
  assert.equal({}.polluted, undefined);
});

test('malformed report, row and array types throw rather than silently discard input', () => {
  for (const input of [null, undefined, '', 'null', 42, true, [], new Date(), new Map()]) assert.throws(() => normaliseCloseoutReport(input), /report must be a JSON object/);
  for (const input of [null, '', 1, [], new Date()]) assert.throws(() => createCloseoutReport(input), /project must be a JSON object/);
  for (const list of Object.keys(listDefinitions)) {
    for (const input of [null, '', {}, 1, false]) assert.throws(() => normaliseCloseoutReport({ [list]: input }), /must be an array/);
    for (const input of [null, '', [], 2, true, new Date(), undefined]) assert.throws(() => normaliseCloseoutReport({ [list]: [input] }), /must be a JSON object/);
    assert.throws(() => normaliseCloseoutReport({ [list]: new Array(1) }), /must be a JSON object/);
    assert.deepEqual(normaliseCloseoutReport({ [list]: [] })[list], []);
  }
  for (const input of [null, undefined, [], {}, 12, false]) assert.throws(() => normaliseCloseoutReport({ name: input }), /must be a string/);
  assert.throws(() => normaliseCloseoutReport({ deliverables: [{ title: { nested: 'bad' } }] }), /deliverables\[0\].title/);
});

test('all row caps are enforced exactly and oversize inputs never truncate', () => {
  for (const [list, definition] of Object.entries(listDefinitions)) {
    const rows = Array.from({ length: definition.cap }, () => ({ ...definition.row }));
    assert.equal(normaliseCloseoutReport({ [list]: rows })[list].length, definition.cap);
    assert.throws(() => normaliseCloseoutReport({ [list]: [...rows, { ...definition.row }] }), new RegExp(`${list} must not exceed ${definition.cap} rows`));
  }
});

test('all text fields enforce 5000-character caps without trimming or truncation', () => {
  const atCap = 'x'.repeat(5000);
  const tooLong = `${atCap}x`;
  for (const field of ['name', 'number', 'client', 'closedBy', 'approvedBy']) {
    assert.equal(normaliseCloseoutReport({ [field]: atCap })[field], atCap);
    assert.throws(() => normaliseCloseoutReport({ [field]: tooLong }), /5000 characters/);
  }
  for (const [list, definition] of Object.entries(listDefinitions)) {
    for (const field of Object.keys(definition.row).filter((key) => !['budget', 'hrs', 'actual', 'due', 'status'].includes(key))) {
      assert.equal(normaliseCloseoutReport({ [list]: [{ ...definition.row, [field]: atCap }] })[list][0][field], atCap);
      assert.throws(() => normaliseCloseoutReport({ [list]: [{ ...definition.row, [field]: tooLong }] }), /5000 characters/);
    }
  }
  assert.equal(normaliseCloseoutReport({ name: '  retain whitespace\nand newlines  ' }).name, '  retain whitespace\nand newlines  ');
});

test('numeric fields accept finite nonnegative decimals only and retain entered values', () => {
  for (const field of ['budget', 'hrs', 'actual']) {
    for (const input of ['', '0', '0.10', '001.2300', '.5', '1.', 0, 0.25, 1e-7, 1e21, Number.MAX_VALUE, Number.MIN_VALUE]) {
      const report = normaliseCloseoutReport({ deliverables: [{ [field]: input }] });
      assert.equal(report.deliverables[0][field], input === '' ? '' : typeof input === 'string' ? input : input.toString().includes('e') ? report.deliverables[0][field] : String(input));
      assert.equal(Number(report.deliverables[0][field]), Number(input));
      assert.deepEqual(normaliseCloseoutReport(report), report);
    }
    for (const input of [-1, NaN, Infinity, -Infinity, null, undefined, {}, [], true, false, 'NaN', 'Infinity', '-1', '-0', '1e3', '0x10', '$1', '1,000', '1.2.3', '12hours', ' 1', '1 ', ' ', '+1', '.', '9'.repeat(400)]) {
      assert.throws(() => normaliseCloseoutReport({ deliverables: [{ [field]: input }] }), /must be/);
    }
    assert.throws(() => normaliseCloseoutReport({ deliverables: [{ [field]: '0'.repeat(5001) }] }), /5000 characters/);
  }
});

test('real ISO dates validate leap years and chronological project/close-out order', () => {
  for (const key of ['start', 'end', 'closeDate']) {
    for (const date of ['', '0001-01-01', '0099-12-31', '1900-02-28', '2000-02-29', '2024-02-29', '9999-12-31']) assert.equal(normaliseCloseoutReport({ [key]: date })[key], date);
    for (const date of ['0000-01-01', '1900-02-29', '2023-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '26-01-01', '2026-1-01', '2026-01-1', '2026-01-01T00:00:00Z', ' 2026-01-01', null, 20260101]) assert.throws(() => normaliseCloseoutReport({ [key]: date }), /must be/);
  }
  assert.throws(() => normaliseCloseoutReport({ lessons: [{ due: '2025-02-29' }] }), /lessons\[0\].due/);
  assert.equal(normaliseCloseoutReport({ lessons: [{ due: '2024-02-29' }] }).lessons[0].due, '2024-02-29');
  assert.throws(() => normaliseCloseoutReport({ start: '2026-01-02', end: '2026-01-01' }), /Final date/);
  assert.throws(() => normaliseCloseoutReport({ start: '2026-01-02', closeDate: '2026-01-01' }), /Close-out date/);
  assert.throws(() => normaliseCloseoutReport({ end: '2026-01-02', closeDate: '2026-01-01' }), /Close-out date/);
  assert.equal(normaliseCloseoutReport({ start: '2026-01-01', end: '2026-01-01', closeDate: '2026-01-01' }).closeDate, '2026-01-01');
  // Future actions are legitimate, and are not constrained by the close-out date.
  assert.equal(normaliseCloseoutReport({ ...validReport(), lessons: [{ due: '2027-01-01' }] }).lessons[0].due, '2027-01-01');
});

test('lesson statuses are exactly the three contract enums', () => {
  for (const status of ['Open', 'In progress', 'Complete']) assert.equal(normaliseCloseoutReport({ lessons: [{ status }] }).lessons[0].status, status);
  for (const status of ['', 'open', 'Completed', 'in_progress', '<script>', 1, null]) assert.throws(() => normaliseCloseoutReport({ lessons: [{ status }] }), /must be/);
  assert.equal(normaliseCloseoutReport({ lessons: [{}] }).lessons[0].status, 'Open');
});

test('totals are numeric, decimal-stable, actual minus budget and inclusive of both dates', () => {
  assert.deepEqual(closeoutTotals(createCloseoutReport()), { budget: 0, budgetHours: 0, actualHours: 0, variance: 0, durationDays: 0 });
  const report = validReport();
  report.deliverables.push({ title: 'Survey', budget: 10.25, hrs: '0.25', actual: 0 });
  assert.deepEqual(closeoutTotals(report), { budget: 1010.5, budgetHours: 10.75, actualHours: 12.75, variance: 2, durationDays: 31 });
  const fractional = { deliverables: [{ budget: '0.1', hrs: '0.1', actual: '0.3' }, { budget: '0.2', hrs: '0.2', actual: '' }] };
  assert.deepEqual(closeoutTotals(fractional), { budget: 0.3, budgetHours: 0.3, actualHours: 0.3, variance: 0, durationDays: 0 });
  assert.equal(closeoutTotals({ deliverables: [{ hrs: '10', actual: '8.25' }] }).variance, -1.75);
  assert.equal(closeoutTotals({ start: '2024-02-28', end: '2024-03-01' }).durationDays, 3);
  assert.equal(closeoutTotals({ start: '2026-10-03', end: '2026-10-05' }).durationDays, 3);
  assert.equal(closeoutTotals({ start: '2026-01-01', end: '2026-01-01' }).durationDays, 1);
  assert.equal(closeoutTotals({ start: '0099-12-31', end: '0100-01-01' }).durationDays, 2);
  assert.throws(() => closeoutTotals({ deliverables: [{ budget: Number.MAX_VALUE }, { budget: Number.MAX_VALUE }] }), /finite numeric range/);
});

test('submission requires the four sign-off fields and a nonblank deliverable title', () => {
  const errors = validateCloseoutSubmission(createCloseoutReport());
  assert.equal(errors.length, 5);
  for (const label of ['Project name', 'Closed out by', 'Approved by', 'Close-out date', 'deliverable title']) assert.ok(errors.some((error) => error.includes(label)));
  assert.deepEqual(validateCloseoutSubmission(validReport()), []);
  for (const key of ['name', 'closedBy', 'approvedBy']) assert.ok(validateCloseoutSubmission({ ...validReport(), [key]: ' \n\t ' }).length > 0);
  assert.ok(validateCloseoutSubmission({ ...validReport(), deliverables: [{ title: '   ' }] }).some((error) => error.includes('deliverable')));
  for (const input of [null, [], { name: 12 }, { end: '2026-02-30' }, { lessons: [{ status: 'unknown' }] }]) assert.ok(validateCloseoutSubmission(input).length > 0);
  assert.deepEqual(validateCloseoutSubmission({ ...validReport(), lessons: [{ lesson: 'Follow up', status: 'Open' }, { lesson: 'Work continues', status: 'In progress' }] }), []);
});

test('export is truly standalone and has the four ordered numbered sections, summary and sign-off', () => {
  const html = renderCloseoutHtml({ report: validReport() });
  assertStandalone(html);
  let previous = -1;
  for (const id of ['summary', 'deliverables', 'project-team', 'hurdles', 'lessons', 'signoff', 'metadata', 'team-responses']) {
    const position = html.indexOf(`id="${id}"`);
    assert.ok(position > previous, `${id} must exist in template order`);
    previous = position;
  }
  for (const number of ['01', '02', '03', '04']) assert.ok(html.includes(`aria-hidden="true">${number}</span>`));
  const text = textContent(html);
  for (const label of ['Deliverables, Budget & Hours', 'Project Team', 'Project Hurdles', 'Lessons Learnt & Actions', 'Total budget', '31 days (inclusive)', 'Closed out by', 'Project Manager', 'Administrator', '2026-02-01', 'Report Metadata & Audit', 'Project Team Responses', 'Draft', 'No team responses supplied.']) assert.ok(text.includes(label), label);
  assert.ok(text.includes('+2.25 hrs'));
  assert.match(html, /linear-gradient\(140deg, #16371f/);
  assert.match(html, /background: #f4f4ee/);
  assert.match(html, /background: #fafbf4/);
  assert.match(html, /white-space: pre-wrap/);
});

test('export uses accessible semantic tables and readable unclipped multipage print styles', () => {
  const html = renderCloseoutHtml({ report: validReport() });
  const tableCount = (html.match(/<table>/g) || []).length;
  assert.ok(tableCount >= 5);
  assert.equal((html.match(/<caption>/g) || []).length, tableCount);
  assert.equal((html.match(/class="table-scroll" role="region" tabindex="0" aria-label="/g) || []).length, tableCount);
  assert.match(html, /<th scope="col">/);
  assert.match(html, /<th scope="row">/);
  assert.match(html, /<tfoot>/);
  assert.match(html, /@media print/);
  assert.match(html, /\.table-scroll \{ overflow: visible/);
  assert.match(html, /thead \{ display: table-header-group/);
  assert.match(html, /break-after: avoid/);
  assert.doesNotMatch(html, /(?:max-height|text-overflow|line-clamp)\s*:/);
});

test('every user context escapes malicious HTML including closing styles and quoted attributes', () => {
  const payload = '</style><script>alert("x")</script><img src=x onerror=alert(1)> & " \'\nSecond line';
  const report = validReport();
  for (const key of ['name', 'number', 'client', 'closedBy', 'approvedBy']) report[key] = payload;
  report.deliverables = [{ title: payload, budget: '', hrs: '', actual: '' }];
  report.seniors = [{ name: payload, role: payload }];
  report.ecologists = [{ name: payload, role: payload }];
  report.hurdles = [{ hurdle: payload, impact: payload, resolution: payload }];
  report.lessons = [{ lesson: payload, action: payload, owner: payload, due: '', status: 'In progress' }];
  const html = renderCloseoutHtml({ report, project: { id: payload, status: payload }, closeout: {
    status: payload, override_reason: payload, override_at: payload, override_by: payload,
    delivery_summary: payload, audit: [{ details: payload }],
  }, feedback: [{ name: payload, staff_user_id: payload, status: payload, submitted_at: payload,
    response: { hurdles: report.hurdles, lessons: report.lessons, legacy: payload } }] });
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.equal((html.match(/<\/style>/g) || []).length, 1);
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.ok(html.includes(escape(payload)));
  assert.ok(html.includes(`aria-label="${escape('Project hurdles')}"`));
  assert.ok(html.includes('&#39;'));
  assert.ok(textContent(html).includes(payload));
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(!style.includes(payload));
  assert.equal(style, renderCloseoutHtml({ report: validReport() }).match(/<style>([\s\S]*?)<\/style>/)[1]);
});

test('export includes state, revision, audit, override actor/time/reason and every legacy note', () => {
  const closeout = {
    id: 'closeout-123', status: 'closed', report_revision: 7,
    export_note: 'Contains unsaved device edits; not a confirmed server save.', review_round: 3,
    created_by: 'creator-id', created_at: '2026-01-01T10:00:00Z', updated_by: 'editor-id', updated_at: '2026-02-01T10:00:00Z',
    locked_at: '2026-02-01T11:00:00Z', locked_by: 'locker-id', override_reason: 'Outstanding review explained\nUrgent completion', override_at: '2026-02-01T12:00:00Z', override_by: 'override-admin',
    success_score: 4, client_outcome: 'legacy-client', delivery_summary: 'legacy-delivery', lessons_learned: 'legacy-lessons', stakeholder_feedback: 'legacy-feedback', financial_review_notes: 'legacy-finance', recommendations: 'legacy-recommendations', approval_note: 'legacy-approval',
    audit_log: [{ action: 'override_close', actor: 'audit-actor', reason: 'audit-reason' }],
  };
  const text = textContent(renderCloseoutHtml({ report: validReport(), closeout, project: { id: 'project-123', status: 'complete', project_lead_user_id: 'lead-id' } }));
  assert.ok(text.includes(closeout.export_note));
  assert.ok(text.includes('Review round'));
  for (const value of ['closeout-123', 'closed', 'Report revision', '7', 'Locked', 'creator-id', 'editor-id', 'locker-id', closeout.override_reason, closeout.override_at, 'override-admin', 'Override actor', 'Override time', 'Override reason', 'Administrative override recorded', 'legacy-client', 'legacy-delivery', 'legacy-lessons', 'legacy-feedback', 'legacy-finance', 'legacy-recommendations', 'legacy-approval', 'audit-actor', 'audit-reason', 'project-123', 'complete', 'lead-id']) assert.ok(text.includes(value), value);
});

test('export retains all capped report rows, every field, full-length text and trailing entries', () => {
  const report = validReport();
  const expected = [];
  for (const [list, definition] of Object.entries(listDefinitions)) {
    report[list] = Array.from({ length: definition.cap }, (_, index) => Object.fromEntries(Object.keys(definition.row).map((field) => {
      let value = `${list}-${index}-${field}-unique`;
      if (['budget', 'hrs', 'actual'].includes(field)) value = `${index + 1}.25`;
      if (field === 'due') value = '2027-12-31';
      if (field === 'status') value = index % 2 ? 'In progress' : 'Open';
      expected.push(value);
      return [field, value];
    })));
  }
  const fullLength = 'L'.repeat(4990) + 'TAIL-12345';
  assert.equal(fullLength.length, 5000);
  report.hurdles[99].resolution = fullLength;
  expected.push(fullLength);
  const html = renderCloseoutHtml({ report });
  assertStandalone(html);
  const text = textContent(html);
  for (const value of expected.filter((value) => value !== 'hurdles-99-resolution-unique')) assert.ok(text.includes(value), `Missing retained value: ${value.slice(0, 100)}`);
  assert.ok(text.includes('100 unfinished lessons / actions'));
});

test('export retains every supplied feedback response and all nested rows, names and fallback IDs', () => {
  const feedback = Array.from({ length: 105 }, (_, index) => ({
    id: `feedback-id-${index}`, staff_user_id: `staff-user-${index}`, staff_name: index % 2 ? `Team member ${index}` : undefined,
    status: index % 2 ? 'submitted' : 'draft', submitted_at: index % 2 ? `submitted-marker-${index}` : null,
    response: {
      hurdles: [{ hurdle: `staff-hurdle-${index}`, impact: `staff-impact-${index}`, resolution: `staff-resolution-${index}` }],
      lessons: [{ lesson: `staff-lesson-${index}`, action: `staff-action-${index}`, owner: `staff-owner-${index}`, due: '2027-01-01', status: 'In progress' }],
    },
  }));
  feedback[104].response.hurdles = Array.from({ length: 100 }, (_, index) => ({ hurdle: `last-response-hurdle-${index}`, impact: `last-response-impact-${index}`, resolution: `last-response-resolution-${index}` }));
  const html = renderCloseoutHtml({ report: validReport(), feedback });
  assertStandalone(html);
  const text = textContent(html);
  for (const [index, entry] of feedback.entries()) {
    assert.ok(text.includes(entry.staff_user_id));
    if (entry.staff_name) assert.ok(text.includes(entry.staff_name));
    assert.ok(text.includes(`staff-lesson-${index}`));
    assert.ok(text.includes(`staff-action-${index}`));
    assert.ok(text.includes(`staff-owner-${index}`));
    if (entry.submitted_at) assert.ok(text.includes(entry.submitted_at));
    for (const row of entry.response.hurdles) for (const value of Object.values(row)) assert.ok(text.includes(value));
  }
  assert.equal((html.match(/class="team-response"/g) || []).length, feedback.length);
  assert.ok(html.includes('<h3 id="response-1">staff-user-0</h3>'));
  assert.ok(html.includes('<h3 id="response-2">Team member 1</h3>'));
});

test('feedback supports optional name shapes, empty drafts and legacy responses without loss', () => {
  const feedback = [
    { staff_user_id: 'id-1', staff: { name: 'Nested staff name' }, response: {} },
    { staff_user_id: 'id-2', name: 'UI person name', response: { hurdles: [], lessons: [], legacy_note: 'Old response note' } },
    { staff_user_id: 'id-3', response: 'Historic plain text\nFull legacy response' },
  ];
  const text = textContent(renderCloseoutHtml({ report: validReport(), feedback }));
  for (const value of ['Nested staff name', 'UI person name', 'id-3', 'Old response note', 'Historic plain text\nFull legacy response', 'No entries recorded.']) assert.ok(text.includes(value));
  assert.throws(() => renderCloseoutHtml({ report: validReport(), feedback: {} }), /feedback must be an array/);
  assert.throws(() => renderCloseoutHtml({ report: validReport(), feedback: [{ response: { hurdles: 'bad' } }] }), /must be an array/);
  assert.throws(() => renderCloseoutHtml({ report: validReport(), feedback: [{ response: { lessons: Array.from({ length: 101 }, () => ({})) } }] }), /100 rows/);
});

test('export supports missing saved reports, closeout.report_data fallback and rejects invalid supplied reports', () => {
  assertStandalone(renderCloseoutHtml());
  const html = renderCloseoutHtml({ closeout: { report_data: validReport() } });
  assert.ok(textContent(html).includes('Wetland restoration'));
  assert.ok(textContent(renderCloseoutHtml({ project: { name: 'Prefilled offline project', client_name: 'Known client' } })).includes('Prefilled offline project'));
  assert.throws(() => renderCloseoutHtml({ report: { hurdles: Array.from({ length: 101 }, () => ({})) } }), /100 rows/);
  assert.throws(() => renderCloseoutHtml({ report: null }), /report must be a JSON object/);
  assert.throws(() => renderCloseoutHtml({ report: { name: 'x'.repeat(5001) } }), /5000 characters/);
});

console.log(`\n${passed} Project Close Report behaviour tests passed.`);
