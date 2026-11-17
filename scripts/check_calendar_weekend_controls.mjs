import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const scheduling = await import(`data:text/javascript;base64,${Buffer.from(await read('lib/staffCalendarScheduling.js')).toString('base64')}`);
const component = await read('components/StaffCapacityPlanner.js');
const styles = await read('app/globals.css');
const start = component.indexOf('  const dropActivity = async (');
const end = component.indexOf('\n\n  // --- Staff:', start);
assert(start >= 0 && end > start, 'Actual calendar drop handler must be found.');
const dropSource = component.slice(start, end) + '\nthis.drop = dropActivity;';
const activity = { id: 'activity-a1', projectId: 'p1', title: 'Current saved activity', startDate: '2026-11-20', endDate: '2026-11-20' };

async function run(date, options = {}) {
  const requests = [], errors = [], resets = [];
  const context = vm.createContext({
    ...scheduling, Date, JSON, Math, String, DAY: 86400000,
    mode: options.mode || 'admin', data: { canEdit: options.canEdit !== false },
    session: { access_token: 'LOCAL-TEST-NOT-A-CREDENTIAL' }, endpoint: '/api/admin/staff-capacity',
    shiftDate: (date, days) => new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10),
    setError: value => errors.push(value), setModalError: () => {}, setDraggedActivity: value => resets.push(value),
    load: async () => {},
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({}) }; },
  });
  vm.runInContext(dropSource, context);
  await context.drop(activity, 'staff-1', date);
  return { requests, errors, resets };
}
for (const date of ['2026-11-21', '2026-11-22']) {
  const result = await run(date);
  assert.equal(result.requests.length, 0, 'Weekend drop must never send a project mutation.');
  assert(result.errors.some(error => error.includes('non-working days')));
  assert.deepEqual(result.resets, [null]);
}
const weekday = await run('2026-11-23');
assert.equal(weekday.requests.length, 1);
assert.equal(weekday.requests[0].init.method, 'PATCH');
assert.deepEqual(JSON.parse(weekday.requests[0].init.body), { staffUserId: 'staff-1', startDate: '2026-11-23', dueDate: '2026-11-23' });
for (const options of [{ mode: 'staff' }, { canEdit: false }]) assert.equal((await run('2026-11-23', options)).requests.length, 0);
assert.match(component, /const canReceiveDrop = mode !== "staff" && data\.canEdit && !day\.nonWorking;/);
assert.match(component, /if \(day\.nonWorking \|\| mode === "staff" \|\| !data\.canEdit\)/, 'Shared weekend drops must also be blocked.');
assert.match(component, /scp-calendar-day-header--non-working/);
assert.match(component, /scp-calendar-cell--non-working/);
assert.match(component, /Non-working day; manual items only/);
assert.match(component, /scp-manual-weekend-notice/);
assert.match(component, /calendarDayPolicy\(manualTaskModal\.startDate, manualTaskModal\.dueDate, true\)/);
assert.match(component, /assigned_to: manualTaskModal\.assignedTo/, 'Manual item keeps the selected recipient.');
assert.match(component, /Manual weekend/);
assert.match(styles, /repeating-linear-gradient\(135deg/);
assert.match(styles, /\.scp \.scp-calendar-cell--non-working/);
console.log('PASS actual drop handler: Saturday/Sunday blocked, weekday PATCH preserved, staff/read-only denied.');
console.log('PASS shaded non-working columns, guarded shared drops and targeted manual weekend UI.');
