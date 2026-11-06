import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import crypto from "node:crypto";

// Offline executable route tests: no credentials, network, live DB or historical writes.
const root = new URL("../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const sharp = createRequire(new URL("package.json", root))("sharp");
const general = await import(moduleUrl(await read("lib/generalEcologicalSwmsTemplate.js")));
assert.equal(crypto.createHash("sha256").update(general.GENERAL_ECOLOGICAL_SWMS_SOURCE_HTML).digest("hex"), general.GENERAL_ECOLOGICAL_SWMS_TEMPLATE_HASH, "Pinned template hash must identify the immutable original supplied source bytes");
assert.equal(general.GENERAL_ECOLOGICAL_SWMS_HIGH_RISK.length, 19);
const legacySource = (await read("lib/ecologicalFieldSwms.js")).replace(/import \{ normaliseGeneralEcologicalSwmsDetails \} from "[^\"]+";/,
  "const normaliseGeneralEcologicalSwmsDetails = value => globalThis.__generalSwmsTest.general.normaliseGeneralEcologicalSwmsDetails(value);");
const model = await import(moduleUrl(legacySource));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const staffId = id(1), otherId = id(2), reviewerId = id(3);
let actor = staffId, isAdmin = false, session = true, deniedResource = "", insertError = null, readError = null, notificationFails = false;
const queries = [], mutations = [], gates = [], events = [], rows = [];
let listUserCalls = 0;
const users = [{ id: reviewerId, email: "review@test.invalid" }, { id: otherId, email: "other@test.invalid" }];
function query(table) {
  const filters = [];
  let kind = "select", value, single = false, columns;
  const q = {
    select(v) { columns = v; return q; }, eq(k, v) { filters.push([k, v]); return q; },
    order() { return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
    insert(v) { kind = "insert"; value = v; return q; }, update(v) { kind = "update"; value = v; return q; },
    then(resolve, reject) {
      queries.push({ table, kind, filters, columns });
      let data = [], error = null;
      if (table === "whs_forms") {
        if (kind === "insert") {
          mutations.push({ table, kind, value: structuredClone(value) });
          if (insertError) error = insertError;
          else if (rows.some(r => r.created_by === value.created_by && r.submission_key === value.submission_key)) error = { code: "23505", message: "duplicate key whs_forms_created_by_submission_key_uidx" };
          else { data = { ...structuredClone(value), id: id(rows.length + 10), created_at: "2026-11-06T00:00:00Z" }; rows.push(data); }
        } else if (kind === "update") {
          mutations.push({ table, kind, value: structuredClone(value) });
          const row = rows.find(r => filters.every(([k, v]) => r[k] === v));
          if (row) { Object.assign(row, value); data = row; }
        } else {
          data = rows.filter(r => filters.every(([k, v]) => r[k] === v));
          if (single) data = data[0] || null;
          error = readError;
        }
      } else if (table === "admin_emails") data = [{ email: "REVIEW@test.invalid" }, { email: "review@test.invalid" }];
      else if (table === "portal_events") {
        assert.equal(kind, "insert");
        if (notificationFails) return Promise.reject(new Error("PRIVATE_NOTIFICATION_SECRET")).then(resolve, reject);
        events.push(...structuredClone(value)); data = value;
      } else assert.fail(`Unexpected table ${table}: project/account scope must not gate staff SWMS submissions.`);
      return Promise.resolve({ data: structuredClone(data), error }).then(resolve, reject);
    },
  };
  return q;
}
const access = { get user() { return { id: actor, email: "fixture@test.invalid" }; }, get isAdmin() { return isAdmin; },
  admin: { from: query, auth: { admin: { async listUsers() { listUserCalls++; return { data: { users } }; } } } } };
globalThis.__generalSwmsTest = {
  general, model,
  access: () => session ? access : { error: Response.json({ error: "Not authenticated." }, { status: 401 }) },
  gate: (_, key) => { gates.push(key); return deniedResource === key ? Response.json({ error: "Denied." }, { status: 403 }) : null; },
  safeError: () => Response.json({ error: "The request could not be completed." }, { status: 500 }), sharp,
};
async function route(file) {
  let source = await read(file);
  source = source
    .replace(/import sharp from "sharp";/, "const sharp = globalThis.__generalSwmsTest.sharp;")
    .replace(/import \{ requireSession, serverError \} from "[^\"]+";/, "const requireSession = async () => globalThis.__generalSwmsTest.access(); const serverError = globalThis.__generalSwmsTest.safeError;")
    .replace(/import \{ PRIMARY_ADMIN_EMAILS, requirePortalResource \} from "[^\"]+";/, "const PRIMARY_ADMIN_EMAILS = []; const requirePortalResource = async (...args) => globalThis.__generalSwmsTest.gate(...args);")
    .replace(/import \{ requirePortalResource \} from "[^\"]+";/, "const requirePortalResource = async (...args) => globalThis.__generalSwmsTest.gate(...args);")
    .replace(/import \{ normalisePreMobilisationDetails \} from "[^\"]+";/, "const normalisePreMobilisationDetails = () => { throw new Error('Unexpected checklist normalization'); };")
    .replace(/import \{ OFFICE_RISK_ITEM_IDS \} from "[^\"]+";/, "const OFFICE_RISK_ITEM_IDS = [];")
    .replace(/import \{ normaliseEcologicalFieldSwmsDetails \} from "[^\"]+";/, "const normaliseEcologicalFieldSwmsDetails = value => globalThis.__generalSwmsTest.model.normaliseEcologicalFieldSwmsDetails(value);");
  return import(moduleUrl(source));
}
const list = await route("app/api/whs-forms/route.js");
const item = await route("app/api/whs-forms/[formId]/route.js");
const req = (body, search = "", method = "POST") => new Request(`https://fixture.test/api/whs-forms${search}`,
  body === undefined ? {} : { method, body: JSON.stringify(body) });
const get = search => req(undefined, search);
const signature = `data:image/png;base64,${(await sharp(Buffer.from('<svg width="240" height="80"><rect width="240" height="80" fill="white"/><path d="M20 60 Q45 5 65 55 T110 30 L150 50 L210 20" fill="none" stroke="black" stroke-width="3"/></svg>')).png().toBuffer()).toString("base64")}`;
const details = general.createBlankGeneralEcologicalSwmsDetails("Fixture Worker", "2026-11-06");
Object.assign(details, { project: "Unassigned project text", client: "Client", jobNumber: "EC-42", site: "Survey site", fieldDuration: "One field day", signedAt: "2026-11-06T00:00:00Z" });
Object.assign(details.team[0], { signature, date: "2026-11-06" });
for (const key of Object.keys(details.highRiskAssessed)) details.highRiskAssessed[key] = true;
const body = { form_type: "ecological_field_swms", title: "Generic SWMS — Ecological Field Surveys", site: "OUTER_SITE_SPOOF", form_date: "1999-01-01", created_by: otherId, submission_key: "SPOOF_KEY", details };
assert.deepEqual(model.normaliseEcologicalFieldSwmsDetails(details).errors, [], "Real shared model fixture must be valid");
assert.equal(general.isGeneralEcologicalSwmsPng(signature), true);
const oldDetails = {
  version: 2, project: "Legacy project", activity: "Habitat survey", site: "Old site", date: "2026-11-05", fieldLead: "Legacy Lead",
  team: [{ name: "Worker", role: "Ecologist", acknowledged: true }], emergencyPlan: "ERP", musterPoint: "Gate", communications: "Radio", conditions: "Clear",
  baseControlsRead: true, sourceDocumentsAvailable: true, noSpecialistHazardConfirmed: true,
  fieldLeadSignature: "data:image/png;base64," + "A".repeat(110),
};
assert.deepEqual(model.normaliseEcologicalFieldSwmsDetails(oldDetails).errors, [], "Legacy version:2 remains valid without new template requirements");
assert.equal(model.normaliseEcologicalFieldSwmsDetails(oldDetails).details.documentCode, "EC-GEN-SWMS-001");
for (const change of [{ templateHash: "tampered" }, { documentCode: "OTHER" }, { documentRevision: "9.0" }, { templateVersion: 3 }, { templateVersion: "2" }]) {
  assert(model.normaliseEcologicalFieldSwmsDetails({ ...details, ...change }).errors.length > 0);
}
assert(model.normaliseEcologicalFieldSwmsDetails({ ...oldDetails, documentCode: "EC-SWMS00" }).errors.length > 0, "Reserved identity cannot downgrade into legacy validation");
const normalized = model.normaliseEcologicalFieldSwmsDetails({ ...details, documentReleaseDate: "2000-01-01", nextReview: "2099-01-01", activity: "ALTERED_CONTROLLED_ACTIVITY", medicalNotes: "PRIVATE_MEDICAL_SECRET", controlsHtml: "<script>bad()</script>" }).details;
assert.equal(normalized.activity, undefined);
assert.equal(normalized.medicalNotes, undefined);
assert.equal(normalized.controlsHtml, undefined);
assert.equal(normalized.documentReleaseDate, "", "Staff cannot set administrative release dates");
assert.equal(normalized.nextReview, "");
const before = structuredClone(details);
model.normaliseEcologicalFieldSwmsDetails(details);
assert.deepEqual(details, before, "Normalization is pure and must not rewrite a draft or history row");
for (const invalid of [
  { ...details, project: "" }, { ...details, site: "" }, { ...details, fieldDuration: "" }, { ...details, date: "2026-02-30" },
  { ...details, team: [] }, { ...details, team: [{ ...details.team[0], signature: "" }] },
  { ...details, team: [{ ...details.team[0], date: "2026-02-30" }] },
  { ...details, team: [...details.team.slice(0, 1), { name: "Unacknowledged worker", role: "Ecologist", signature: "", date: "" }] },
  { ...details, team: [...details.team.slice(0, 1), { name: "", role: "Ecologist", signature: "", date: "" }] },
  { ...details, team: [...details.team, { name: "Seventh worker", role: "Ecologist", signature, date: "2026-11-06" }] },
  { ...details, highRiskAssessed: {} },
  { ...details, highRiskAssessed: Object.fromEntries(Object.keys(details.highRiskAssessed).map(k => [k, "true"])) },
  ...["data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64"), "data:image/png;base64," + "A".repeat(110), signature + "A".repeat(360001)].map(bad => ({ ...details, team: [{ ...details.team[0], signature: bad }] })),
]) {
  const writes = mutations.length;
  assert.equal((await list.POST(req({ ...body, details: invalid }))).status, 400);
  assert.equal(mutations.length, writes, "Invalid source/crew/signature/assessment cannot be inserted");
}
session = false;
assert.equal((await list.GET(get("?scope=mine&type=ecological_field_swms"))).status, 401);
assert.equal((await list.POST(req(body))).status, 401);
session = true; deniedResource = "staff.forms";
assert.equal((await list.POST(req(body))).status, 403);
deniedResource = "";
const corruptBytes = Buffer.from(signature.slice(22), "base64");
for (let p = 8; p + 12 <= corruptBytes.length; p += corruptBytes.readUInt32BE(p) + 12) {
  if (corruptBytes.toString("ascii", p + 4, p + 8) === "IDAT") { corruptBytes[p + 8] = 0; break; }
}
const corruptSignature = "data:image/png;base64," + corruptBytes.toString("base64");
assert.equal(general.isGeneralEcologicalSwmsPng(corruptSignature), true, "Chunk-only validation alone is not raster decoding");
assert.equal((await list.POST(req({ ...body, details: { ...details, team: [{ ...details.team[0], signature: corruptSignature }] } }))).status, 400, "Native decoder must reject corrupt pixel data");
let response = await list.POST(req(body));
assert.equal(response.status, 201);
let payload = await response.json();
const saved = payload.form;
assert.equal(saved.created_by, staffId, "No caller account override");
assert.equal(saved.site, details.site); assert.equal(saved.form_date, details.date);
assert.equal(saved.title, "Generic SWMS — Ecological Field Surveys: Unassigned project text — General ecological survey work");
assert(!saved.title.includes("undefined")); assert.notEqual(saved.submission_key, body.submission_key);
assert.equal(saved.details.documentCode, "EC-SWMS00"); assert.equal(saved.details.templateVersion, 2);
assert.equal(saved.details.templateHash, general.GENERAL_ECOLOGICAL_SWMS_TEMPLATE_HASH);
assert.equal(saved.details.team[0].signature, signature, "Signature bytes retained, never re-encoded");
assert.equal(gates.at(-1), "staff.forms"); assert.equal(events.length, 1);
assert.equal(events[0].event_type, "ecological_field_swms_submitted");
assert.equal(events[0].source_id, saved.id); assert.equal(events[0].href, "/?mode=whsmonitor");
assert(!JSON.stringify(events).includes(signature));
const notificationCount = events.length, beforeRetry = rows.length;
const reordered = Object.fromEntries(Object.entries(details).reverse());
reordered.highRiskAssessed = Object.fromEntries(Object.entries(details.highRiskAssessed).reverse());
response = await list.POST(req({ ...body, details: reordered }));
assert.equal(response.status, 200); payload = await response.json();
assert.equal(payload.duplicate, true); assert.equal(payload.form.id, saved.id);
assert.equal(rows.length, beforeRetry); assert.equal(events.length, notificationCount, "Duplicate must not renotify");
const concurrentBody = { ...body, details: { ...details, site: "Concurrent site" } };
const concurrent = await Promise.all([list.POST(req(concurrentBody)), list.POST(req(concurrentBody))]);
assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 201]);
assert.equal(rows.filter(r => r.site === "Concurrent site").length, 1, "Synchronous unique guard retains one history entry");
actor = otherId;
assert.equal((await list.POST(req(body))).status, 201, "Same document from another worker is not this worker's duplicate");
actor = staffId;
response = await list.POST(req({ ...body, details: { ...details, signedAt: "2026-11-06T00:00:01Z" } }));
assert.equal(response.status, 201, "Changed signature event metadata is a different payload, not an exact retry");
const oldBody = { form_type: "ecological_field_swms", title: "Legacy", details: oldDetails };
assert.equal((await list.POST(req(oldBody))).status, 201, "Legacy submission remains supported and must not acquire native decode requirements");
const historical = rows.find(r => r.details.documentCode === "EC-GEN-SWMS-001");
const storedBeforeGet = JSON.stringify(rows), writesBeforeGet = mutations.length;
response = await list.GET(get("?scope=mine&type=ecological_field_swms"));
payload = await response.json();
assert(payload.forms.every(r => r.created_by === staffId));
assert.deepEqual(payload.forms.find(r => r.id === historical.id).details, historical.details);
assert.equal(gates.at(-1), "staff.forms");
assert.deepEqual(queries.at(-1).filters, [["created_by", staffId], ["form_type", "ecological_field_swms"]]);
payload = await (await list.GET(get("?type=ecological_field_swms"))).json();
assert(payload.forms.every(r => r.created_by === staffId), "Ordinary staff history is own-only without scope=mine too");
isAdmin = true; deniedResource = "admin.whs_monitoring";
assert.equal((await list.GET(get("?scope=mine&type=ecological_field_swms"))).status, 200, "Admin personal history uses staff gate");
assert.equal((await list.GET(get("?type=ecological_field_swms"))).status, 403, "Admin review gate remains enforced");
assert.equal((await list.POST(req(body))).status, 200, "Admin staff submission must not require project/admin scope");
deniedResource = "";
assert.equal((await list.GET(get("?type=ecological_field_swms"))).status, 200);
assert.equal(gates.at(-1), "admin.whs_monitoring");
assert.equal(mutations.length, writesBeforeGet + 1, "Only the explicit POST retry attempted insertion; GET never writes");
assert.equal(JSON.stringify(rows), storedBeforeGet, "No legacy/new history rewritten by GET or retry");
assert(listUserCalls > 0);
isAdmin = false;
readError = { message: "PRIVATE_DATABASE_SECRET details.team.signature" };
response = await list.GET(get("?scope=mine&type=ecological_field_swms"));
assert.equal(response.status, 400); assert(!JSON.stringify(await response.json()).includes("PRIVATE_"));
response = await list.GET(get("?scope=mine"));
assert.equal(response.status, 400); assert(!JSON.stringify(await response.json()).includes("PRIVATE_"), "The real unfiltered staff forms history feed must also return safe errors");
readError = null;
for (const err of [{ code: "23514", message: "PRIVATE_DATABASE_SECRET" }, { code: "23505", message: "OTHER_INDEX_PRIVATE_DATABASE_SECRET" }]) {
  insertError = err;
  response = await list.POST(req({ ...body, details: { ...details, site: "Unsaved site" } }));
  assert.equal(response.status, 400); assert(!JSON.stringify(await response.json()).includes("PRIVATE_"));
}
insertError = null; notificationFails = true;
const priorWarn = console.warn; console.warn = () => {};
try { assert.equal((await list.POST(req({ ...body, details: { ...details, site: "Notification outage" } }))).status, 201, "Notification failure is non-fatal after saved WHS record"); }
finally { console.warn = priorWarn; notificationFails = false; }
assert.equal((await item.PATCH(req({ action: "reviewed", details: { project: "Overwrite" } }, "", "PATCH"), { params: { formId: saved.id } })).status, 403);
isAdmin = true;
const originalSigned = structuredClone(rows.find(r => r.id === saved.id).details);
assert.equal((await item.PATCH(req({ action: "reviewed", review_note: "Reviewed", details: { project: "Overwrite" } }, "", "PATCH"), { params: { formId: saved.id } })).status, 200);
assert.deepEqual(rows.find(r => r.id === saved.id).details, originalSigned, "Admin review cannot replace signed controlled details");
assert.equal(mutations.at(-1).value.details, undefined);
delete globalThis.__generalSwmsTest;
console.log("General ecological SWMS workflow passed: real version/hash model, immutable controlled fields, populated crew/date/PNG gates and native raster decode, legacy compatibility, staff-owned/admin personal history, zero GET writes, authoritative metadata, concurrent retry/no renotify, server-owned account identity, unchanged WHS review notifications and safe errors.");
