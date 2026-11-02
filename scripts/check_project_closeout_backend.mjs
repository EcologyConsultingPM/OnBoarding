import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const templateUrl = moduleUrl(await read('lib/projectCloseoutTemplate.js'));
const helperSource = await read('lib/projectCloseoutServer.js');
const helperUrl = moduleUrl(helperSource.replace('"./projectCloseoutTemplate"', JSON.stringify(templateUrl)));
const helpers = await import(helperUrl);
const { prepareCloseoutMutation: prepare, normaliseOwnResponse, CloseoutError, closeoutRpcError, closeoutTeam } = helpers;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = id(1), staff = id(2), outsider = id(3), otherStaff = id(4);
const project = { id: id(10), name: 'Ecology test', client_name: 'Client', start_date: '2026-01-01', end_date: '2026-02-01' };
const fullReport = { name: 'Ecology test', closedBy: 'Lead', approvedBy: 'Manager', closeDate: '2026-03-01', deliverables: [{ title: 'Final survey', budget: '.5', hrs: '1.', actual: '2' }], lessons: [{ lesson: 'Retain unfinished actions', status: 'Open' }] };
const report = prepare({ action: 'submit_report', expectedRevision: 0, report: fullReport }, project).payload.report;
assert.equal(report.name, 'Ecology test');
assert.equal(report.lessons[0].status, 'Open');
for (const invalid of [undefined, -1, 0.5, '0']) assert.throws(() => prepare({ action: 'save_report', expectedRevision: invalid, report: {} }, project), /expectedRevision/);
for (const invalid of [null, [], 'bad']) assert.throws(() => normaliseOwnResponse(invalid));
assert.throws(() => normaliseOwnResponse({ hurdles: null }), /array/);
assert.throws(() => normaliseOwnResponse({ lessons: [{ due: '2026-02-30' }] }), /date/);
assert.throws(() => normaliseOwnResponse({ name: 'Overwrite master' }), /only hurdles and lessons/);
assert.throws(() => prepare({ action: 'save_feedback', response: {}, staffUserId: outsider }, project), /only your own/);
assert.throws(() => prepare({ action: 'submit_report', expectedRevision: 0, report: {} }, project), /Closed out by/);
assert.throws(() => prepare({ action: 'override_close', expectedRevision: 0, reason: ' ' }, project), /reason/);
assert.throws(() => prepare({ action: 'save_report', expectedRevision: 0, report: { seniors: Array.from({ length: 4 }, () => ({})) } }, project), /3 rows/);
assert.throws(() => prepare({ action: 'upsert_improvement', title: 'Test', dueDate: '2026-02-30' }, project), /valid/);
assert.equal(closeoutRpcError({ message: 'CLOSEOUT_REVISION_CONFLICT: Reload the report.' }).status, 409);
assert.equal(closeoutRpcError({ code: 'PGRST202' }).status, 503);

// Exercise real GET/POST code with isolated dependency adapters. No network.
const apiProject = { ...project, status: 'active' };
const apiCloseout = { id: id(20), project_id: project.id, report_revision: 3, review_round: 1, financial_review_notes: 'PRIVATE_INTERNAL_FINANCE', override_reason: 'PRIVATE_ADMIN_REASON', report_data: report };
let adminFlag = false, invited = true, member = true, portalAllowed = true, mutationCalls = 0;
let scopedFeedback = false;
const queries = [];
function query(table) {
  const filters = [];
  const q = {
    select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, is() { return q; }, order() { return q; }, limit() { return q; }, range() { return q; },
    maybeSingle() { return q; },
    then(resolve, reject) {
      queries.push([table, filters]);
      let data;
      if (table === 'projects') data = apiProject;
      else if (table === 'project_closeouts') data = apiCloseout;
      else if (table === 'project_closeout_invitations') data = invited ? { id: id(30), staff_user_id: staff, review_round: 1, status: 'pending' } : null;
      else if (table === 'project_closeout_feedback') {
        scopedFeedback = filters.some(([k, v]) => k === 'closeout_id' && v === apiCloseout.id) && filters.some(([k, v]) => k === 'staff_user_id' && v === staff);
        data = [{ id: id(40), staff_user_id: staff, closeout_id: apiCloseout.id, response: {} }];
      } else data = [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return q;
}
const fakeAccess = { user: { id: staff }, get isAdmin() { return adminFlag; }, admin: { from: query, async rpc(name) { if (name === 'project_closeout_is_team_member') return { data: member }; mutationCalls += 1; return { data: { feedback: { staff_user_id: staff } } }; } } };
globalThis.__closeoutBackendTest = { access: fakeAccess, permission: () => portalAllowed ? null : Response.json({ error: 'Denied' }, { status: 403 }) };
let routeSource = await read('app/api/projects/[projectId]/closeout/route.js');
routeSource = routeSource.replace(/import \{ requireSession, serverError \} from "[^"]+";/, `const requireSession = async () => globalThis.__closeoutBackendTest.access; const serverError = () => Response.json({error:'Unexpected server error'}, {status:500});`)
  .replace(/import \{ requirePortalResource \} from "[^"]+";/, `const requirePortalResource = async () => globalThis.__closeoutBackendTest.permission();`)
  .replace('"../../../../../lib/projectCloseoutServer"', JSON.stringify(helperUrl));
const api = await import(moduleUrl(routeSource));
const args = { params: { projectId: project.id } };
const request = (audience = '', body) => new Request(`https://local.test/api/projects/${project.id}/closeout${audience}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
let response = await api.GET(request(), args);
assert.equal(response.status, 200);
let payload = await response.json();
assert.equal(payload.canManage, false);
assert.deepEqual(payload.team, []);
assert.deepEqual(payload.actions, []);
assert.equal(scopedFeedback, true, 'Staff reads must scope feedback before pagination.');
assert.equal(mutationCalls, 0, 'GET must never create records.');
assert.equal(payload.closeout.financial_review_notes, undefined, 'Staff API must redact internal legacy finance notes.');
assert.equal(payload.closeout.override_reason, undefined, 'Staff API must redact private administrative override reasons.');
assert.deepEqual(payload.closeout.report_data, report, 'The invited template itself remains available.');
invited = false;
assert.equal((await api.GET(request(), args)).status, 403);
invited = true; member = false;
assert.equal((await api.GET(request(), args)).status, 403);
member = true; adminFlag = true;
payload = await (await api.GET(request('?audience=staff'), args)).json();
assert.equal(payload.closeout.financial_review_notes, undefined, 'An administrator in staff audience must receive the same redaction.');
assert.equal((await api.POST(request('?audience=staff', { action: 'save_report', report, expectedRevision: 3 }), args)).status, 403);
assert.equal((await api.POST(request('?audience=staff', { action: 'save_feedback', response: { hurdles: [], lessons: [] } }), args)).status, 200);
assert.equal(mutationCalls, 1);
portalAllowed = false;
assert.equal((await api.GET(request('?audience=staff'), args)).status, 403);
portalAllowed = true;
assert.equal((await api.POST(new Request(`https://local.test/api/projects/${project.id}/closeout?audience=staff`, { method: 'POST', body: '{' }), args)).status, 400);
delete globalThis.__closeoutBackendTest;
console.log('Backend validation and real route tests passed (recipient scoping, portal denial, own response, no GET writes, revision and malformed JSON).');

// Run SQL integration tests when PGlite is available. Optional test dependency,
// deliberately not added to the application's package.json. This is a fresh
// in-memory PostgreSQL instance: it cannot connect to any live Supabase project.
let pgliteModule;
try {
  const require = createRequire(import.meta.url);
  pgliteModule = process.env.CLOSEOUT_PGLITE_MODULE || require.resolve('@electric-sql/pglite');
} catch {
  try { pgliteModule = createRequire('/home/ubuntu/tmp/closeout-db-test/package.json').resolve('@electric-sql/pglite'); }
  catch { console.log('SQL integration skipped: install @electric-sql/pglite separately and set CLOSEOUT_PGLITE_MODULE to its module path.'); process.exit(0); }
}
const { PGlite } = await import(pathToFileURL(pgliteModule).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', deleted_at timestamptz, banned_until timestamptz);
create table public.admin_emails(email text primary key);
create table public.portal_visibility_overrides(user_id uuid, resource_key text, is_visible boolean);
create table public.projects(id uuid primary key, name text, status text default 'active', project_lead_user_id uuid, overseeing_senior_ecologist_user_id uuid, deleted_at timestamptz, updated_at timestamptz default now());
create table public.project_allocations(id uuid primary key default gen_random_uuid(), project_id uuid, staff_user_id uuid, role_on_project text, active boolean default true);
create table public.project_activities(id uuid primary key default gen_random_uuid(), project_id uuid, staff_user_id uuid, acceptance_status text, is_active boolean default true);
create table public.project_activity_assignees(id uuid primary key default gen_random_uuid(), activity_id uuid, staff_user_id uuid, role text, acceptance_status text, removed_at timestamptz);
create table public.portal_events(id uuid primary key default gen_random_uuid(), recipient_id uuid, event_type text, severity text, title text, body text, href text, source_table text, source_id uuid, created_at timestamptz default now(), read_at timestamptz, dismissed_at timestamptz);
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(), actor_id uuid, action text, entity_type text, entity_id uuid, project_id uuid, resource_key text, before_data jsonb, after_data jsonb, reason text, created_at timestamptz default now());
`);
await db.exec(await read('sql/2026-09-02-project-closeout.sql'));
const migration = await read('sql/2026-11-03-project-close-report.sql');
await db.exec(migration);
await db.exec(migration); // Additive migration must also be safe to reapply.
await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6),($7,$8)', [actor, 'manager@ecologyconsulting.au', staff, 'staff@ecologyconsulting.au', outsider, 'outsider@ecologyconsulting.au', otherStaff, 'other@ecologyconsulting.au']);
await db.query('insert into public.admin_emails(email) values ($1)', ['manager@ecologyconsulting.au']);
for (const number of [10, 11, 12, 13, 14, 15, 16]) await db.query('insert into public.projects(id,name,project_lead_user_id) values ($1,$2,$3)', [id(number), `Test project ${number}`, actor]);
await db.query('insert into public.project_allocations(project_id,staff_user_id) values ($1,$2),($1,$3)', [project.id, staff, otherStaff]);
const isMember = async (projectId, userId) => (await db.query('select public.project_closeout_is_team_member($1,$2) as member', [projectId, userId])).rows[0].member;
assert.equal(await isMember(project.id, actor), true, 'Project leads are team members.');
assert.equal(await isMember(project.id, outsider), false);
await db.query('insert into public.project_activities(id,project_id,staff_user_id,acceptance_status) values ($1,$2,$3,$4)', [id(80), id(15), outsider, 'accepted']);
assert.equal(await isMember(id(15), outsider), true, 'Active scalar activities remain compatible.');
await db.query('insert into public.project_activity_assignees(activity_id,staff_user_id,acceptance_status) values ($1,$2,$3)', [id(80), outsider, 'declined']);
assert.equal(await isMember(id(15), outsider), false, 'A declined join-table assignment must not fall back to the scalar activity.');
await db.query("update public.project_activity_assignees set acceptance_status='awaiting_response' where activity_id=$1", [id(80)]);
assert.equal(await isMember(id(15), outsider), true);
await db.query('update public.project_activity_assignees set removed_at=now() where activity_id=$1', [id(80)]);
assert.equal(await isMember(id(15), outsider), false);
await db.query("update auth.users set raw_user_meta_data='{" + '"staff_directory_active":false' + "}' where id=$1", [otherStaff]);
assert.equal(await isMember(project.id, otherStaff), false, 'Inactive identities cannot be invited even when allocated.');
await db.query("update auth.users set raw_user_meta_data='{}' where id=$1", [otherStaff]);
const mutate = async (action, revision, data = {}, actorId = actor, projectId = project.id, staffAudience = false) => {
  const result = await db.query('select public.mutate_project_closeout($1::uuid,$2::uuid,$3::text,$4::integer,$5::jsonb,$6::boolean) as result', [projectId, actorId, action, revision, JSON.stringify(data), staffAudience]);
  return result.rows[0].result;
};
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rejects = async (work, marker) => { try { await work; assert.fail(`Expected ${marker}`); } catch (error) { assert.match(error.message, new RegExp(marker)); } };
let result = await mutate('save_report', 0, { report });
let rev = result.closeout.report_revision;
assert.equal(rev, 1);
await rejects(mutate('save_report', 0, { report }), 'REVISION_CONFLICT');
await rejects(mutate('save_report', rev, { report }, staff), 'FORBIDDEN');
await rejects(mutate('save_report', rev, { report }, actor, project.id, true), 'FORBIDDEN');
await rejects(mutate('invite_team', rev, { staffUserIds: [outsider] }), 'NOT_TEAM');
result = await mutate('invite_team', rev, { staffUserIds: [staff, otherStaff] }); rev = result.report_revision;
assert.equal(result.invited_count, 2);
assert.equal((await scalar("select count(*)::int as count from public.portal_events where event_type='project_closeout_invited'")).count, 2);
result = await mutate('invite_team', rev, { staffUserIds: [staff, otherStaff] }); rev = result.report_revision;
assert.equal(result.invited_count, 0);
assert.equal((await scalar("select count(*)::int as count from public.portal_events where event_type='project_closeout_invited'")).count, 2);
await rejects(mutate('submit_report', rev, { report }), 'OUTSTANDING_REVIEWS');
assert.equal((await scalar('select status from public.projects where id=$1', [project.id])).status, 'active');
assert.equal((await scalar('select report_revision from public.project_closeouts where project_id=$1', [project.id])).report_revision, rev);
await rejects(mutate('save_feedback', null, { response: {} }, outsider, project.id, true), 'NOT_TEAM');
await mutate('save_feedback', null, { response: { hurdles: [{ hurdle: 'Staff-only draft' }], lessons: [] } }, staff, project.id, true);
await mutate('submit_feedback', null, { response: { hurdles: [{ hurdle: 'Retain original' }], lessons: [{ lesson: 'Retained', status: 'Open' }] } }, staff, project.id, true);
assert.equal((await scalar("select href from public.portal_events where event_type='project_closeout_feedback_submitted' limit 1")).href, `/?portal=admin&workspace=adminprojects&projectView=closeout&projectId=${project.id}`, 'Administrator review links must open this specific close-out sub-domain.');
await rejects(mutate('save_feedback', null, { response: {} }, staff, project.id, true), 'RESPONSE_SUBMITTED');
const original = (await scalar('select response from public.project_closeout_feedback where staff_user_id=$1', [staff])).response;
await rejects(mutate('submit_report', rev, { report }), 'OUTSTANDING_REVIEWS');
result = await mutate('lock_report', rev, { report }); rev = result.report_revision;
assert.equal((await scalar('select status from public.projects where id=$1', [project.id])).status, 'active');
await rejects(mutate('save_report', rev, { report }), 'LOCKED');
await rejects(mutate('save_feedback', null, { response: {} }, otherStaff, project.id, true), 'LOCKED');
result = await mutate('override_close', rev, { reason: 'Final sign-off despite outstanding team review' }); rev = result.report_revision;
assert.equal(result.closeout.status, 'closed');
assert.equal(result.closeout.applied_to_project, true);
assert.equal((await scalar('select status from public.projects where id=$1', [project.id])).status, 'complete');
assert.equal((await scalar("select count(*)::int as count from public.portal_events where dismissed_at is null")).count, 0);
assert.equal((await scalar("select status from public.project_closeout_invitations where staff_user_id=$1", [otherStaff])).status, 'cancelled');
assert.equal((await scalar("select status from public.project_closeout_feedback where staff_user_id=$1", [otherStaff])).status, 'draft');
assert.deepEqual((await scalar('select response from public.project_closeout_feedback where staff_user_id=$1', [staff])).response, original);
await rejects(mutate('save_report', rev, { report }), 'LOCKED');
await rejects(mutate('reopen_report', rev, { reason: ' ' }), 'INVALID_INPUT');
result = await mutate('reopen_report', rev, { reason: 'Additional review requested' }); rev = result.report_revision;
assert.equal(result.review_round, 2);
assert.equal((await scalar('select status from public.projects where id=$1', [project.id])).status, 'active');
await rejects(mutate('save_feedback', null, { response: {} }, staff, project.id, true), 'NOT_INVITED');
result = await mutate('invite_team', rev, { staffUserIds: [staff] }); rev = result.report_revision;
await mutate('submit_feedback', null, { response: { hurdles: [], lessons: [] } }, staff, project.id, true);
assert.equal((await scalar('select count(*)::int as count from public.project_closeout_feedback where staff_user_id=$1', [staff])).count, 2);
result = await mutate('submit_report', rev, { report }); rev = result.report_revision;
assert.equal(result.closeout.status, 'closed');
assert.deepEqual((await scalar('select response from public.project_closeout_feedback where staff_user_id=$1 and review_round=1', [staff])).response, original);
assert.equal((await scalar('select count(*)::int as count from public.project_closeout_revisions where project_id=$1', [project.id])).count, rev);

// Legacy completed reports require reasoned reopen, retaining untouched fields.
await db.query("insert into public.project_closeouts(project_id,status,locked_at,delivery_summary) values ($1,'closed',now(),'Legacy retained')", [id(11)]);
await db.query("update public.projects set status='complete' where id=$1", [id(11)]);
await rejects(mutate('save_report', 0, { report }, actor, id(11)), 'LOCKED');
let legacy = await mutate('reopen_report', 0, { reason: 'Review the historical report' }, actor, id(11));
assert.equal(legacy.closeout.delivery_summary, 'Legacy retained');
assert.equal((await scalar('select status from public.projects where id=$1', [id(11)])).status, 'complete', 'Legacy closeout did not mark this project complete; reopen must not change it.');
legacy = await mutate('save_report', 1, { report }, actor, id(11));
assert.equal(legacy.closeout.report_data.name, report.name, 'Explicit reopen permits report editing without changing independent project completion.');
assert.equal(legacy.closeout.delivery_summary, 'Legacy retained');
await db.query("update public.projects set status='archived' where id=$1", [id(11)]);
await rejects(mutate('reopen_report', 2, { reason: 'Never implicitly unarchive' }, actor, id(11)), 'LOCKED');

// A completed project may still need its first close report. Preparing and
// reopening that report must not reactivate independently completed delivery.
await db.query("update public.projects set status='complete' where id=$1", [id(16)]);
let historical = await mutate('save_report', 0, { report }, actor, id(16));
assert.equal(historical.closeout.status, 'initiated');
assert.equal((await scalar('select status from public.projects where id=$1', [id(16)])).status, 'complete');
historical = await mutate('submit_report', 1, { report }, actor, id(16));
assert.equal(historical.closeout.applied_to_project, false);
historical = await mutate('reopen_report', 2, { reason: 'Correct report only' }, actor, id(16));
assert.equal(historical.closeout.locked_at, null);
assert.equal((await scalar('select status from public.projects where id=$1', [id(16)])).status, 'complete');

// Cross-project improvement IDs and closeout links cannot be moved or mutated.
const closeoutId = result.closeout.id;
await rejects(mutate('upsert_improvement', null, { title: 'Cross-project', closeoutId }, actor, id(12)), 'INVALID_INPUT');
const improvementResult = await mutate('upsert_improvement', null, { title: 'Pending improvement', status: 'draft' }, actor, id(12));
await rejects(mutate('archive_improvement', null, { actionId: improvementResult.action.id }, actor, id(13)), 'NOT_FOUND');
await db.query('update public.project_improvement_actions set locked=true where id=$1', [improvementResult.action.id]);
await rejects(mutate('archive_improvement', null, { actionId: improvementResult.action.id }, actor, id(12)), 'LOCKED');
const overridden = await mutate('override_close', 0, { reason: 'Explicit bypass without report' }, actor, id(12));
assert.equal(overridden.closeout.report_data, null);
assert.equal((await scalar('select title from public.project_improvement_actions where id=$1', [improvementResult.action.id])).title, 'Pending improvement');
await rejects(mutate('archive_project', 1, {}, actor, id(12)), 'OPEN_IMPROVEMENTS');
await rejects(mutate('upsert_improvement', null, { title: 'Cannot change closed work' }, actor, id(12)), 'LOCKED');
const archived = await mutate('archive_project', rev, {}, actor);
assert.equal(archived.closeout.status, 'archived');
await rejects(mutate('reopen_report', archived.report_revision, { reason: 'No unarchive' }), 'LOCKED');

// Verify rollback when a downstream audit write fails: project+report are atomic.
await db.exec(`create function public.test_fail_audit() returns trigger language plpgsql as $$ begin if new.project_id='${id(14)}'::uuid then raise exception 'TEST_AUDIT_FAIL'; end if; return new; end; $$; create trigger test_fail_audit before insert on public.admin_audit_log for each row execute function public.test_fail_audit();`);
await rejects(mutate('override_close', 0, { reason: 'Must roll back' }, actor, id(14)), 'TEST_AUDIT_FAIL');
assert.equal((await scalar('select status from public.projects where id=$1', [id(14)])).status, 'active');
assert.equal((await scalar('select count(*)::int as count from public.project_closeouts where project_id=$1', [id(14)])).count, 0);
await db.query('update public.projects set deleted_at=now() where id=$1', [id(15)]);
await rejects(mutate('override_close', 0, { reason: 'Do not write deleted projects' }, actor, id(15)), 'NOT_FOUND');
assert.equal(await isMember(id(15), actor), false);

// SQL permissions are actual PostgreSQL ACL checks, not source-string checks.
for (const role of ['anon', 'authenticated']) {
  assert.equal((await scalar("select has_function_privilege($1, 'public.mutate_project_closeout(uuid,uuid,text,integer,jsonb,boolean)', 'EXECUTE') as allowed", [role])).allowed, false);
  assert.equal((await scalar("select has_table_privilege($1, 'public.project_closeout_invitations', 'SELECT') as allowed", [role])).allowed, false);
}
assert.equal((await scalar("select has_function_privilege('service_role', 'public.mutate_project_closeout(uuid,uuid,text,integer,jsonb,boolean)', 'EXECUTE') as allowed")).allowed, true);
assert.equal((await scalar("select relrowsecurity as enabled from pg_class where oid='public.project_closeout_invitations'::regclass")).enabled, true);
console.log('Isolated PostgreSQL tests passed: migration/reapply, real ACL/RLS, revisions, conflict rollback, invitations/deduplication, own immutable responses, pending-review gate, lock/override/reopen rounds, legacy preservation, cross-project improvement denial, archive gate and downstream-failure atomic rollback.');
await db.close();
