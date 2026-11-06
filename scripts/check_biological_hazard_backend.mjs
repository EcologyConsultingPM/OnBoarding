import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Never reads production credentials, makes network calls or touches the live DB.
const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const staff = id(1), adminId = id(2), other = id(3), eventId = id(10), photoId = id(20);
const details = { documentCode: 'EC-WHS-BIO-002', documentRevision: 1, category: 'exp', fields: { bio_worker: 'MEDICAL_WORKER_SECRET', bio_symptoms: 'MEDICAL_DETAILS_SECRET' }, declaration: { name: 'Worker', date: '2026-11-06', signature: 'SIGNED_SUBMISSION_SECRET' } };
const event = { id: eventId, register_number: 'BIO-000001', created_by: staff, details, status: 'Open', version: 1, admin_notes: 'INTERNAL_SECRET', follow_up_notes: 'INTERNAL_FOLLOWUP_SECRET', closure_reason: 'INTERNAL_CLOSURE_SECRET' };
let actor = staff, adminFlag = false, permission = true, dbAdmin = true, session = true, rpcError = null;
let submitted = false, queryError = null, photoLinked = true, decodeFails = false, sharpMissing = false;
let attachThrows = false;
const calls = [], permissions = [], uploadCalls = [], removeCalls = [], signedCalls = [], queries = [];
const storedPhoto = { id: photoId, event_id: eventId, storage_path: `events/${eventId}/${photoId}.jpeg`, file_name: 'photo.jpeg', mime_type: 'image/jpeg', size_bytes: 100 };
function query(table) {
  const filters = [];
  let single = false, columns, bounds;
  const q = {
    select(value) { columns = value; return q; }, eq(k, v) { filters.push([k, v]); return q; },
    order() { return q; }, limit(n) { bounds = [0, n - 1]; return q; }, range(a,b) { bounds = [a,b]; return q; },
    maybeSingle() { single = true; return q; },
    then(resolve, reject) {
      queries.push({ table, filters, columns, bounds });
      let data = [];
      if (table === 'biological_hazard_events') {
        const own = filters.find(([k]) => k === 'created_by');
        data = own && own[1] !== event.created_by ? single ? null : [] : single ? event : [event];
      } else if (table === 'biological_hazard_photos') {
        const name = filters.find(([k]) => k === 'file_name');
        data = single ? photoLinked && (!name || name[1] === storedPhoto.file_name) ? storedPhoto : null : [storedPhoto];
      }
      else if (table === 'biological_hazard_updates') data = [{ id: id(30), event_id: eventId, action: 'admin_updated', version: 2, reason: 'INTERNAL_REASON_SECRET', before_data: { status: 'Open', admin_notes: 'INTERNAL_SECRET' }, after_data: { status: 'Closed', follow_up_notes: 'INTERNAL_FOLLOWUP_SECRET' } }];
      return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 1, error: queryError }).then(resolve, reject);
    },
  };
  return q;
}
const storage = {
  async upload(path, bytes, options) { uploadCalls.push({ path, bytes, options }); return { data: { path } }; },
  async remove(paths) { removeCalls.push(paths); return { data: [] }; },
  async createSignedUrl(path, expiry) { signedCalls.push({ path, expiry }); return { data: { signedUrl: 'https://private.test/signed?token=REDACTED' } }; },
};
const access = { get user() { return { id: actor, email: 'fixture@test.invalid' }; }, get isAdmin() { return adminFlag; }, admin: { from: query, storage: { from(bucket) { assert.equal(bucket, 'biological-hazard-photos'); return storage; } },
  async rpc(name, params) {
    calls.push({ name, params });
    if (name === 'biological_hazard_can_manage') return { data: dbAdmin };
    if (rpcError) return { error: rpcError };
    if (name === 'biological_hazard_submit') { const duplicate = submitted; submitted = true; return { data: { event, duplicate } }; }
    if (name === 'biological_hazard_update') return { data: { ...event, version: 2 } };
    if (name === 'biological_hazard_attach_photo') { if (attachThrows) throw new Error('Lost response'); return { data: { ...params.p_photo, event_id: eventId } }; }
    assert.fail(`Unexpected RPC ${name}`);
  },
} };
const fakeSharp = () => {
  const pipeline = { async metadata() { if (decodeFails) throw new Error('STORAGE_SECRET'); return { format: 'jpeg', width: 10, height: 10, pages: 1 }; }, rotate() { return pipeline; }, resize() { return pipeline; }, flatten() { return pipeline; }, jpeg() { return pipeline; }, async toBuffer() { return Buffer.from([255,216,255,219,0,1,2]); } };
  return pipeline;
};
globalThis.__bioBackendTest = {
  access: () => session ? access : { error: Response.json({ error: 'Not authenticated.' }, { status: 401 }) },
  permission: (_, key) => { permissions.push(key); return permission ? null : Response.json({ error: 'Denied.' }, { status: 403 }); },
  normalize: value => value?.documentCode === 'EC-WHS-BIO-002' ? { details: value, errors: {} } : { details: null, errors: { documentCode: 'Invalid document.' } },
  sharp: () => { if (sharpMissing) throw new Error('Missing'); return fakeSharp; },
};
async function route(file) {
  const source = (await read(file))
    .replace(/import nativeSharp from "sharp";/, `const nativeSharp = () => null;`)
    .replace(/import \{ requireSession \} from "[^"]+";/, `const requireSession = async () => globalThis.__bioBackendTest.access();`)
    .replace(/import \{ requirePortalResource \} from "[^"]+";/, `const requirePortalResource = async (...args) => globalThis.__bioBackendTest.permission(...args);`)
    .replace(/import \{ normaliseBiologicalHazardDetails \} from "[^"]+";/, `const normaliseBiologicalHazardDetails = value => globalThis.__bioBackendTest.normalize(value);`)
    .replace(/const nodeRequire = [^;]+;/, `const nodeRequire = () => globalThis.__bioBackendTest.sharp();`);
  return import(moduleUrl(source));
}
const list = await route('app/api/biological-hazards/route.js');
const item = await route('app/api/biological-hazards/[eventId]/route.js');
const photos = await route('app/api/biological-hazards/[eventId]/photos/route.js');
const args = { params: { eventId } };
const req = (query = '', body, method = 'POST') => new Request(`https://local.test/api/biological-hazards${query}`, body === undefined ? {} : { method, body: JSON.stringify(body) });
const mutationCount = () => calls.filter(c => ['biological_hazard_submit','biological_hazard_update','biological_hazard_attach_photo'].includes(c.name)).length;
session = false;
for (const [handler, request, context] of [[list.GET, req(), undefined], [list.POST, req('', {}), undefined], [item.GET, req(), args], [item.PATCH, req('', {}, 'PATCH'), args], [photos.GET, req(), args], [photos.POST, req(), args]]) assert.equal((await handler(request, context)).status, 401);
session = true;
let payload = await (await list.GET(req('?scope=mine'))).json();
assert.equal(payload.events[0].admin_notes, undefined);
assert.equal(payload.events[0].follow_up_notes, undefined);
assert.equal(payload.total, 1);
assert.equal(permissions.at(-1), 'staff.forms');
assert.deepEqual(queries.at(-1).filters, [['created_by', staff]]);
assert.equal(mutationCount(), 0, 'GET must not write');
assert.equal((await list.GET(req('?limit=101'))).status, 400);
assert.equal((await list.GET(req('?page=0'))).status, 400);
assert.equal((await list.GET(req('?offset=-1'))).status, 400);
assert.equal((await list.GET(req('?scope=admin'))).status, 403);
adminFlag = true;
payload = await (await list.GET(req('?scope=mine'))).json();
assert.equal(payload.events[0].admin_notes, undefined, 'Admin in mine scope gets staff redaction');
assert.deepEqual(queries.at(-1).filters, [['created_by', staff]], 'Admin mine must remain owned');
actor = adminId;
payload = await (await list.GET(req('?scope=mine'))).json();
assert.deepEqual(payload.events, []);
assert.equal((await item.GET(req('?scope=mine'), args)).status, 404);
assert.equal((await photos.GET(req(`?scope=mine&photoId=${photoId}`), args)).status, 404);
assert.equal(signedCalls.length, 0);
actor = staff;
payload = await (await item.GET(req('?scope=mine'), args)).json();
assert(!JSON.stringify(payload).includes('INTERNAL_'), 'Internal notes must be redacted from event and full history');
assert.equal(payload.photos[0].storage_path, undefined, 'Photo metadata must not expose keys');
assert.deepEqual(payload.event.details, details, 'Own original signed report is retained');
assert.equal((await item.PATCH(req('?scope=mine', { version: 1, status: 'Closed' }, 'PATCH'), args)).status, 403);
permission = false;
assert.equal((await list.GET(req('?scope=admin'))).status, 403);
assert.equal((await item.GET(req('?scope=admin'), args)).status, 403);
permission = true; dbAdmin = false;
assert.equal((await list.GET(req('?scope=admin'))).status, 403);
dbAdmin = true;
payload = await (await item.GET(req('?scope=admin'), args)).json();
assert.equal(payload.event.admin_notes, 'INTERNAL_SECRET');
assert.equal(payload.canManage, true);
assert.equal(permissions.at(-1), 'admin.whs_monitoring');
for (const patch of [{ version: 0, status: 'Open' }, { version: 1, details: {} }, { version: 1, closed_by: other }, { version: 1, follow_up_date: '2026-02-30' }, { version: 1, admin_notes: null }]) assert.equal((await item.PATCH(req('?scope=admin', patch, 'PATCH'), args)).status, 400);
rpcError = { message: 'BIO_VERSION_CONFLICT: RAW_MEDICAL_SECRET' };
let response = await item.PATCH(req('?scope=admin', { version: 1, status: 'In progress' }, 'PATCH'), args);
assert.equal(response.status, 409); assert(!JSON.stringify(await response.json()).includes('RAW_'));
rpcError = null;
assert.equal((await item.PATCH(req('?scope=admin', { version: 1, status: 'In progress' }, 'PATCH'), args)).status, 200);
assert.equal(calls.at(-1).params.p_actor_id, staff);
adminFlag = false;
assert.equal((await list.POST(req('', { details, submission_key: 'spoof' }))).status, 400);
assert.equal((await list.POST(req('', { details: {}, submission_key: id(40) }))).status, 400);
assert.equal((await list.POST(req('', { details, submission_key: id(40), created_by: other }))).status, 400);
assert.equal((await list.POST(req('', { details: 'x'.repeat(600001), submission_key: id(40) }))).status, 413);
assert.equal((await list.POST(req('', { details, submission_key: id(40) }))).status, 201);
assert.equal((await list.POST(req('', { details, submission_key: id(40) }))).status, 200);
assert.equal(calls.at(-1).params.p_actor_id, staff);
assert.equal(permissions.at(-1), 'staff.forms');
queryError = { message: 'RAW_MEDICAL_DATABASE_SECRET', details: 'PRIVATE_PATH' };
response = await list.GET(req('?scope=mine'));
assert.equal(response.status, 500); assert(!JSON.stringify(await response.json()).includes('SECRET'));
queryError = null;
photoLinked = false;
assert.equal((await photos.GET(req(`?scope=mine&photoId=${photoId}`), args)).status, 404);
photoLinked = true;
assert.equal((await photos.GET(req(`?scope=mine&photoId=${photoId}`), args)).status, 200);
assert.deepEqual(signedCalls.at(-1), { path: storedPhoto.storage_path, expiry: 300 });
const imageRequest = (bytes = Buffer.from([255,216,255,219,0,1,2]), type = 'image/jpeg', name = 'spoof.svg') => {
  const form = new FormData(); form.append('file', new Blob([bytes], { type }), name);
  return new Request(`https://local.test/api/biological-hazards/${eventId}/photos?scope=mine`, { method: 'POST', body: form });
};
assert.equal((await photos.POST(imageRequest(Buffer.from('<svg>evil</svg>'), 'image/svg+xml'), args)).status, 400);
assert.equal((await photos.POST(imageRequest(Buffer.from([255,216,255]), 'image/png'), args)).status, 400);
assert.equal((await photos.POST(imageRequest(Buffer.alloc(8388609), 'image/jpeg'), args)).status, 413);
sharpMissing = true;
assert.equal((await photos.POST(imageRequest(), args)).status, 503);
sharpMissing = false; decodeFails = true;
assert.equal((await photos.POST(imageRequest(), args)).status, 400);
decodeFails = false;
rpcError = { message: 'BIO_PHOTO_LIMIT: RAW_STORAGE_SECRET' };
assert.equal((await photos.POST(imageRequest(), args)).status, 409);
assert.equal(removeCalls.length, 1, 'Failed attachment must delete uploaded object');
assert.deepEqual(removeCalls[0], [uploadCalls.at(-1).path]);
rpcError = null;
response = await photos.POST(imageRequest(), args);
assert.equal(response.status, 201);
assert.equal((await response.json()).photo.storage_path, undefined);
assert.match(uploadCalls.at(-1).path, new RegExp(`^events/${eventId}/[0-9a-f-]{36}\\.jpeg$`));
assert.equal(uploadCalls.at(-1).options.upsert, false);
assert.equal(calls.at(-1).params.p_photo.file_name, 'photo.jpeg', 'Client filename must not be trusted');
attachThrows = true;
const removalsBefore = removeCalls.length;
assert.equal((await photos.POST(imageRequest(), args)).status, 201);
assert.equal(removeCalls.length, removalsBefore, 'Lost response with committed metadata must not delete stored object');
photoLinked = false;
assert.equal((await photos.POST(imageRequest(), args)).status, 500);
assert.equal(removeCalls.length, removalsBefore + 1, 'Lost response with confirmed missing metadata must clean up');
photoLinked = true; attachThrows = false;
// Exercise the real production decoder, not only the earlier adapter mock.
const nativeSharp = createRequire(new URL('../package.json', import.meta.url))('sharp');
globalThis.__bioBackendTest.sharp = () => nativeSharp;
const realPng = await nativeSharp({ create: { width: 3100, height: 1200, channels: 3, background: '#537c63' } }).png().withMetadata({ exif: { IFD0: { Copyright: 'QA_METADATA_MUST_NOT_SURVIVE' } } }).toBuffer();
const retryName = `biological-${id(88)}.jpg`;
response = await photos.POST(imageRequest(realPng, 'image/png', retryName), args);
assert.equal(response.status, 201);
assert.equal(calls.at(-1).params.p_photo.file_name, retryName);
const decoded = await nativeSharp(uploadCalls.at(-1).bytes).metadata();
assert.equal(decoded.format, 'jpeg'); assert(decoded.width <= 2400 && decoded.height <= 2400);
assert.equal(decoded.exif, undefined, 'Native re-encode strips EXIF, including GPS metadata');
const uploadCountBeforeRetry = uploadCalls.length, mutationBeforeRetry = mutationCount();
storedPhoto.file_name = retryName;
response = await photos.POST(imageRequest(realPng, 'image/png', retryName), args);
assert.equal(response.status, 201); assert.equal((await response.json()).duplicate, true);
assert.equal(uploadCalls.length, uploadCountBeforeRetry); assert.equal(mutationCount(), mutationBeforeRetry);
storedPhoto.file_name = 'photo.jpeg';
assert.equal((await photos.POST(imageRequest(), args)).status, 400, 'Truncated magic-only data is rejected by native decoding');
globalThis.__bioBackendTest.sharp = () => fakeSharp;
// The production normalizer arrives from the parallel model worker. Test the
// actual POST route wired to that module, not only an isolated validation mock.
const shared = await import(moduleUrl(await read('lib/biologicalHazardRegister.js')));
globalThis.__bioBackendTest.normalize = shared.normaliseBiologicalHazardDetails;
const signedForm = shared.createEmptyBiologicalHazardForm();
signedForm.category = 'obs';
Object.assign(signedForm.fields, { bio_date: '2026-11-06', bio_worker: 'Worker', bio_proj: 'Survey', bio_loc: 'Crossing', bio_haz: 'Ticks', bio_meddet: 'STALE_MEDICAL_SECRET' });
signedForm.declaration = { name: 'Worker', date: '2026-11-06', signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=' };
assert.equal((await list.POST(req('', { details: signedForm, submission_key: id(41) }))).status, 200);
assert.equal(calls.at(-1).params.p_details.fields.bio_meddet, '', 'The shared model must strip hidden stale medical details before RPC');
assert.equal(calls.at(-1).params.p_details.declaration.signature, signedForm.declaration.signature);
assert.equal((await list.POST(req('', { details: { ...signedForm, declaration: { ...signedForm.declaration, signature: '' } }, submission_key: id(42) }))).status, 400);
delete globalThis.__bioBackendTest;
console.log('Real route mocks passed: all-session/resource checks, admin DB check, mine-even-admin ownership, redacted history, immutable patch allowlist, safe errors, retry key, linked 300s photo URL, magic/size/decode fail-closed, SQL-attach cleanup.');

let pgliteModule;
try { pgliteModule = process.env.BIOLOGICAL_PGLITE_MODULE || createRequire(import.meta.url).resolve('@electric-sql/pglite'); }
catch { try { pgliteModule = createRequire('/home/ubuntu/tmp/closeout-db-test/package.json').resolve('@electric-sql/pglite'); } catch { throw new Error('PGlite is required for backend SQL checks; set BIOLOGICAL_PGLITE_MODULE to a local module path.'); } }
const { PGlite } = await import(pathToFileURL(pgliteModule).href);
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', deleted_at timestamptz, banned_until timestamptz);
create table public.admin_emails(email text);
create table public.portal_visibility_overrides(user_id uuid, resource_key text, is_visible boolean);
create table public.portal_events(id uuid primary key default gen_random_uuid(), recipient_id uuid references auth.users(id), event_type text, severity text, title text, body text, href text, source_table text, source_id uuid, created_at timestamptz default now());
create table public.admin_audit_log(id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), action text, entity_type text, entity_id uuid, project_id uuid, resource_key text, before_data jsonb, after_data jsonb, reason text, created_at timestamptz default now());
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
create policy test_legacy_wide_storage on storage.objects for all to anon,authenticated using(true) with check(true);
`);
const migration = await read('sql/2026-11-06-biological-hazard-register.sql');
await db.exec(migration); await db.exec(migration);
// A legacy permissive policy must not make this private bucket browser-readable.
await db.query('insert into storage.objects(bucket_id) values($1),($2)', ['biological-hazard-photos','unrelated-bucket']);
for (const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows, [{ bucket_id: 'unrelated-bucket' }]);
  await assert.rejects(db.query('insert into storage.objects(bucket_id) values($1)', ['biological-hazard-photos']), /row-level security/);
  await db.exec('reset role');
}
await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6),($7,$8)', [staff, 'staff@test.invalid', adminId, 'review@test.invalid', other, 'other@test.invalid', id(4), 'aaron.dooley@ecologyconsulting.au']);
await db.query('insert into public.admin_emails(email) values($1),($2)', ['review@test.invalid', 'REVIEW@test.invalid']);
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rejects = async (work, marker) => assert.rejects(work, error => new RegExp(marker).test(error.message));
const submit = async (actorId = staff, key = id(100), data = details) => (await scalar('select public.biological_hazard_submit($1::uuid,$2::jsonb,$3::uuid) result', [actorId, JSON.stringify(data), key])).result;
const update = async (event, version, patch, actorId = adminId) => (await scalar('select public.biological_hazard_update($1::uuid,$2::uuid,$3::integer,$4::jsonb) result', [actorId,event,version,JSON.stringify(patch)])).result;
const attach = async (event, number, actorId = staff, override = {}) => (await scalar('select public.biological_hazard_attach_photo($1::uuid,$2::uuid,$3::jsonb) result', [actorId,event,JSON.stringify({ id: id(number), storage_path: `events/${event}/${id(number)}.jpeg`, file_name: 'photo.jpeg', mime_type: 'image/jpeg', size_bytes: 100, ...override })])).result;
assert.equal((await scalar('select public.biological_hazard_can_manage($1) allowed',[staff])).allowed, false);
assert.equal((await scalar('select public.biological_hazard_can_manage($1) allowed',[adminId])).allowed, true);
await db.query("insert into public.portal_visibility_overrides values($1,'admin.whs',false)",[adminId]);
assert.equal((await scalar('select public.biological_hazard_can_manage($1) allowed',[adminId])).allowed, false);
await db.exec('delete from public.portal_visibility_overrides');
await db.query("insert into public.portal_visibility_overrides values($1,'admin.projects',false)",[adminId]);
assert.equal((await scalar('select public.biological_hazard_can_manage($1) allowed',[adminId])).allowed, true, 'WHS-only admin must not depend on project visibility');
await db.query("insert into public.portal_visibility_overrides values($1,'admin.whs_monitoring',false)",[id(4)]);
assert.equal((await scalar('select public.biological_hazard_can_manage($1) allowed',[id(4)])).allowed, true, 'Primary admin recovery survives visibility overrides');
await db.exec('delete from public.portal_visibility_overrides');
await rejects(submit(id(999)), 'BIO_FORBIDDEN');
await rejects(submit(staff,id(999),{ ...details, documentRevision: 2 }), 'BIO_INVALID_INPUT');
await db.exec('set role service_role');
await assert.rejects(db.query('insert into public.biological_hazard_events(created_by,submission_key,details) values($1,$2,$3)', [staff,id(100),JSON.stringify(details)]), /permission denied/);
let result = await submit();
await db.exec('reset role');
const dbEvent = result.event.id;
assert.equal(result.event.status,'Open'); assert.equal(result.event.version,1); assert.equal(result.event.register_number,'BIO-000001');
assert.equal(result.duplicate,false);
const notifications = (await db.query('select recipient_id,body from public.portal_events')).rows;
assert.deepEqual(notifications.map(n => n.recipient_id).sort(),[adminId,id(4)].sort(), 'Only review administrators, deduplicated case-insensitive emails');
result = await submit(staff,id(100),{ ...details, fields: {} });
assert.equal(result.duplicate,true); assert.deepEqual(result.event.details,details);
assert.equal((await scalar('select count(*)::int n from public.portal_events')).n,2, 'No replayed notifications');
assert.equal((await scalar('select count(*)::int n from public.admin_audit_log')).n,1, 'No replayed audit');
assert.equal((await scalar('select count(*)::int n from public.biological_hazard_updates')).n,1, 'No replayed history');
await rejects(update(dbEvent,1,{status:'Closed'},staff),'BIO_FORBIDDEN');
await rejects(update(dbEvent,0,{status:'Open'}),'BIO_INVALID_INPUT');
await rejects(update(dbEvent,1,{details:{}}),'BIO_INVALID_INPUT');
await rejects(update(dbEvent,1,{status:'Closed',closure_reason:'Completed'}),'BIO_CLOSURE_REQUIRED');
await rejects(update(dbEvent,1,{follow_up_date:'2026-02-30'}),'BIO_INVALID_INPUT');
await rejects(update(dbEvent,1,{action_owner_id:id(999)}),'BIO_INVALID_INPUT');
result = await update(dbEvent,1,{status:'In progress',admin_notes:'INTERNAL_CLINICAL_SECRET',action_owner_id:other});
assert.equal(result.version,2);
await rejects(update(dbEvent,1,{status:'Open'}),'BIO_VERSION_CONFLICT');
assert.equal((await scalar('select version from public.biological_hazard_events where id=$1',[dbEvent])).version,2);
assert.deepEqual((await db.query("select recipient_id from public.portal_events where event_type='biological_hazard_updated'")).rows.map(n=>n.recipient_id).sort(),[staff,other].sort());
result = await update(dbEvent,2,{status:'Closed',closure_reason:'INTERNAL_CLOSURE_SECRET',follow_up_date:'2026-11-06',follow_up_notes:'INTERNAL_CLINICAL_SECRET'});
assert.equal(result.status,'Closed'); assert.equal(result.closed_by,adminId); assert(result.closed_at); assert.equal(result.version,3);
assert.deepEqual(result.details,details);
await rejects(db.query('update public.biological_hazard_events set details=$1 where id=$2',[JSON.stringify({...details,category:'obs'}),dbEvent]),'BIO_IMMUTABLE');
await rejects(db.query('delete from public.biological_hazard_events where id=$1',[dbEvent]),'BIO_IMMUTABLE');
await rejects(db.exec("update public.biological_hazard_updates set reason='overwrite'"),'BIO_IMMUTABLE');
await rejects(attach(dbEvent,200,other),'BIO_FORBIDDEN');
await rejects(attach(dbEvent,200,staff,{storage_path:'events/OTHER/evil.jpeg'}),'BIO_INVALID_INPUT');
await rejects(attach(dbEvent,200,staff,{mime_type:'image/svg+xml'}),'BIO_INVALID_INPUT');
for (let n=200;n<205;n++) await attach(dbEvent,n);
await rejects(attach(dbEvent,205),'BIO_PHOTO_LIMIT');
assert.equal((await scalar('select count(*)::int n from public.biological_hazard_photos where event_id=$1',[dbEvent])).n,5);
assert.equal((await scalar('select version from public.biological_hazard_events where id=$1',[dbEvent])).version,8);
const feeds = JSON.stringify((await db.query('select body,title from public.portal_events')).rows) + JSON.stringify((await db.query('select before_data,after_data,reason from public.admin_audit_log')).rows);
for (const secret of ['MEDICAL_', 'SIGNED_', 'INTERNAL_', 'events/']) assert(!feeds.includes(secret),'No medical/internal prose or photo path in broad feeds');
assert.equal((await scalar('select public from storage.buckets where id=$1',['biological-hazard-photos'])).public,false);
for (const table of ['biological_hazard_events','biological_hazard_updates','biological_hazard_photos']) {
  assert.equal((await scalar("select relrowsecurity enabled from pg_class where oid=$1::regclass",[`public.${table}`])).enabled,true);
  assert.equal((await scalar('select count(*)::int n from pg_policies where schemaname=$1 and tablename=$2',['public',table])).n,0);
  for (const role of ['anon','authenticated','service_role']) for (const privilege of ['INSERT','UPDATE','DELETE']) assert.equal((await scalar('select has_table_privilege($1,$2,$3) allowed',[role,`public.${table}`,privilege])).allowed,false);
}
for (const signature of ['biological_hazard_submit(uuid,jsonb,uuid)','biological_hazard_update(uuid,uuid,integer,jsonb)','biological_hazard_attach_photo(uuid,uuid,jsonb)']) {
  for (const role of ['anon','authenticated']) assert.equal((await scalar('select has_function_privilege($1,$2,$3) allowed',[role,`public.${signature}`,'EXECUTE'])).allowed,false);
  assert.equal((await scalar('select has_function_privilege($1,$2,$3) allowed',['service_role',`public.${signature}`,'EXECUTE'])).allowed,true);
}
// Force downstream failures: every row, version, history, notification and audit must roll back.
await db.exec(`create function public.bio_test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAIL'; end; $$; create trigger bio_test_fail_audit before insert on public.admin_audit_log for each row execute function public.bio_test_fail_audit();`);
const beforeCounts = await scalar('select (select count(*) from public.biological_hazard_events)::int events,(select count(*) from public.portal_events)::int notifications,(select count(*) from public.biological_hazard_updates)::int updates');
await rejects(submit(staff,id(101)),'TEST_AUDIT_FAIL');
assert.deepEqual(await scalar('select (select count(*) from public.biological_hazard_events)::int events,(select count(*) from public.portal_events)::int notifications,(select count(*) from public.biological_hazard_updates)::int updates'),beforeCounts);
await rejects(update(dbEvent,8,{status:'Open'}),'TEST_AUDIT_FAIL');
assert.equal((await scalar('select status,version from public.biological_hazard_events where id=$1',[dbEvent])).version,8);
await db.exec('drop trigger bio_test_fail_audit on public.admin_audit_log');
const second = (await submit(staff,id(102))).event;
await db.exec('create trigger bio_test_fail_audit before insert on public.admin_audit_log for each row execute function public.bio_test_fail_audit()');
await rejects(attach(second.id,300),'TEST_AUDIT_FAIL');
assert.equal((await scalar('select count(*)::int n from public.biological_hazard_photos where event_id=$1',[second.id])).n,0);
assert.equal((await scalar('select version from public.biological_hazard_events where id=$1',[second.id])).version,1);
await db.exec('drop trigger bio_test_fail_audit on public.admin_audit_log');
await db.exec(`create function public.bio_test_fail_notification() returns trigger language plpgsql as $$ begin raise exception 'TEST_NOTIFICATION_FAIL'; end; $$; create trigger bio_test_fail_notification before insert on public.portal_events for each row execute function public.bio_test_fail_notification();`);
await rejects(update(second.id,1,{status:'In progress'}),'TEST_NOTIFICATION_FAIL');
assert.equal((await scalar('select version from public.biological_hazard_events where id=$1',[second.id])).version,1);
await db.exec('drop trigger bio_test_fail_notification on public.portal_events');
const retryPhoto = { id: id(800), storage_path: `events/${second.id}/${id(800)}.jpeg`, file_name: `biological-${id(801)}.jpg`, mime_type: 'image/jpeg', size_bytes: 250 };
const firstPhoto = (await scalar('select public.biological_hazard_attach_photo($1,$2,$3::jsonb) r',[staff,second.id,JSON.stringify(retryPhoto)])).r;
const afterFirst = await scalar('select version from public.biological_hazard_events where id=$1',[second.id]);
const retriedPhoto = (await scalar('select public.biological_hazard_attach_photo($1,$2,$3::jsonb) r',[staff,second.id,JSON.stringify({ ...retryPhoto, id:id(802), storage_path:`events/${second.id}/${id(802)}.jpeg` })])).r;
assert.equal(retriedPhoto.id,firstPhoto.id,'Locked photo retry returns the existing attachment');
assert.deepEqual(await scalar('select version from public.biological_hazard_events where id=$1',[second.id]),afterFirst);
assert.equal((await scalar('select count(*)::int n from public.biological_hazard_photos where event_id=$1',[second.id])).n,1);
await db.query("update auth.users set raw_user_meta_data='{"+'"staff_directory_active":false'+"}' where id=$1",[other]);
await rejects(submit(other,id(103)),'BIO_FORBIDDEN');
console.log('PGlite transactions passed: migration/reapply, canonical schema, admin helper visibility, active auth fixtures, idempotence/no replay, immutable details/history/delete denial, version conflict, closure follow-up, targeted recipient privacy, 5-photo row lock/cap/path, real ACL/RLS and audit/notification rollback.');
await db.close();
