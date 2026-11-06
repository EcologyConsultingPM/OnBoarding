import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Next transpiles .js ESM; a data URL avoids editing package.json or dependencies.
const model = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(root, "lib/biologicalHazardRegister.js"), "utf8")).toString("base64")}`);
const { BIOLOGICAL_DOCUMENT_CODE, BIOLOGICAL_DOCUMENT_REVISION, BIOLOGICAL_CATEGORIES,
  BIOLOGICAL_FIELD_SECTIONS: sections, createEmptyBiologicalHazardForm: empty,
  normaliseBiologicalHazardDetails: normalize, buildBiologicalHotspots: hotspots,
  exportBiologicalRegisterCsv: csv } = model;
const fields = sections.flatMap((section) => section.fields);
const schema = Object.fromEntries(fields.map((field) => [field.key, field]));
const signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";
const results = [];
function check(label, callback) {
  try { callback(); results.push([label, true]); }
  catch (error) { results.push([`${label}: ${error.message}`, false]); }
}
function valid(category = "obs") {
  const form = empty();
  form.category = category;
  Object.assign(form.fields, { bio_date: "2026-11-06", bio_worker: "Alex Example", bio_proj: "Creek survey", bio_loc: "South crossing", bio_haz: "Ticks" });
  if (["exp", "inj"].includes(category)) form.fields.bio_extype = "Attachment";
  if (category === "nm") form.fields.bio_fail = schema.bio_fail.options[0];
  if (["exp", "inj", "nm"].includes(category)) form.fields.bio_ca = "No — existing controls adequate";
  form.declaration = { name: "Alex Example", date: "2026-11-06", signature };
  return form;
}
function accepted(form, options) {
  const result = normalize(form, options);
  assert.deepEqual(result.errors, []);
  assert.ok(result.details);
  return result.details;
}
function rejected(form, label, options) {
  const result = normalize(form, options);
  assert.equal(result.details, null, label);
  assert.ok(result.errors.length, label);
}

check("controlled document identity and all five category labels match the contract", () => {
  assert.equal(BIOLOGICAL_DOCUMENT_CODE, "EC-WHS-BIO-002");
  assert.equal(BIOLOGICAL_DOCUMENT_REVISION, 1);
  assert.deepEqual(BIOLOGICAL_CATEGORIES, [
    { value: "obs", label: "Observation / hotspot" }, { value: "pot", label: "Potential exposure" },
    { value: "exp", label: "Exposure incident" }, { value: "inj", label: "Injury / illness incident" },
    { value: "nm", label: "Near miss / control failure" },
  ]);
});
check("source sections are numbered 2–8, 10–11 and have every original signed field in order", () => {
  assert.deepEqual(sections.map(({ title, categories }) => [title, categories]), [
    ["2. Event details", undefined], ["3. Hazard", undefined], ["4. Observation and hotspot", ["obs"]],
    ["5. Potential exposure", ["pot"]], ["6. Exposure details", ["exp", "inj"]],
    ["7. Injury, illness and medical treatment", ["inj"]], ["8. Near miss or control failure", ["nm"]],
    ["10. Corrective action", undefined], ["11. Follow-up", ["exp", "inj"]],
  ]);
  assert.deepEqual(sections.map((section) => section.fields.map(({ key }) => key)), [
    ["bio_date", "bio_time", "bio_worker", "bio_pos", "bio_rec", "bio_proj", "bio_loc", "bio_coord"],
    ["bio_haz", "bio_ident", "bio_num", "bio_cond", "bio_ppe", "bio_rep"],
    ["bio_hot", "bio_extent", "bio_season", "bio_rec_ctrl"],
    ["bio_dur", "bio_insp", "bio_psym", "bio_why"],
    ["bio_extype", "bio_count", "bio_body", "bio_fa", "bio_fadet"],
    ["bio_sym", "bio_med", "bio_rep_to", "bio_ir", "bio_meddet"],
    ["bio_fail", "bio_pot", "bio_nmdet"],
    ["bio_ca", "bio_owner", "bio_due", "bio_action"],
    ["bio_fu", "bio_fusym", "bio_fudet"],
  ]);
  assert.equal(new Set(sections.map((section) => section.id)).size, sections.length);
  assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  assert.deepEqual(fields.filter((field) => field.required).map((field) => field.key), ["bio_date", "bio_worker", "bio_proj", "bio_loc", "bio_haz", "bio_extype", "bio_fail"]);
});
// This optional exact-source comparison is available in the implementation
// sandbox; all behavioral/schema tests remain portable when it is absent.
const reference = "/home/ubuntu/tmp/biological-register-reference/template.html";
if (fs.existsSync(reference)) check("every field label/type/choice exactly matches decoded source lines 519–547", () => {
  const source = fs.readFileSync(reference, "utf8").split("\n").slice(518, 547).join("\n");
  const decode = (text) => text.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s*\*\s*$/, "").trim();
  const excluded = new Set(["bio_id", "bio_status", "bio_closer", "bio_dname", "bio_ddate", "bio_photo"]);
  const extracted = [];
  const chunks = source.split('<div class="field">').slice(1);
  for (const chunk of chunks) {
    const control = chunk.match(/<(input|select|textarea)\b([^>]*)>/);
    if (!control) continue;
    const key = control[2].match(/(?:id|name)="(bio_[^"]+)"/)?.[1];
    if (!key || excluded.has(key)) continue;
    const label = decode(chunk.match(/<label>([\s\S]*?)<\/label>/)?.[1] ?? "");
    let type = control[1] === "input" ? control[2].match(/type="([^"]+)"/)?.[1] : control[1];
    let options;
    if (type === "checkbox") {
      type = "chips";
      options = [...chunk.matchAll(new RegExp(`name="${key}" value="([^"]+)"`, "g"))].map((match) => decode(match[1]));
    }
    if (type === "select") options = [...chunk.matchAll(/<option(?:\s[^>]*)?>([\s\S]*?)<\/option>/g)].map((match) => decode(match[1])).filter((value) => value !== "Select…");
    extracted.push({ key, label, type, ...(options ? { options } : {}) });
  }
  assert.deepEqual(fields.map(({ required, ...field }) => field), extracted);
});
check("empty forms contain string defaults, exactly three chip arrays, and separate declaration", () => {
  const a = empty(), b = empty();
  assert.deepEqual(Object.keys(a), ["documentCode", "documentRevision", "category", "fields", "declaration"]);
  assert.equal(a.category, "");
  assert.deepEqual(Object.keys(a.fields), fields.map((field) => field.key));
  assert.deepEqual(fields.filter((field) => field.type === "chips").map((field) => field.key), ["bio_cond", "bio_ppe", "bio_sym"]);
  for (const field of fields) assert.deepEqual(a.fields[field.key], field.type === "chips" ? [] : "");
  for (const key of ["bio_cat", "bio_photo", "bio_id", "bio_status", "bio_closer", "bio_dname", "bio_ddate"]) assert.equal(Object.hasOwn(a.fields, key), false);
  assert.deepEqual(a.declaration, { name: "", date: "", signature: "" });
  a.fields.bio_cond.push("Wet"); a.declaration.name = "Changed";
  assert.deepEqual(b.fields.bio_cond, []); assert.equal(b.declaration.name, "");
});

for (const { value: category } of BIOLOGICAL_CATEGORIES) {
  check(`${category}: preserves every active field and blanks every irrelevant field without mutating input`, () => {
    const form = valid(category);
    for (const section of sections) for (const field of section.fields) {
      // Deliberately populate hidden medical fields too, to detect stale retention.
      form.fields[field.key] = field.type === "chips" ? [...field.options] : field.type === "select" ? field.options[0]
        : field.type === "date" ? "2024-02-29" : field.type === "time" ? "23:59" : field.type === "number" ? "0" : `Recorded ${field.key}`;
    }
    const original = structuredClone(form);
    const detail = accepted(form);
    for (const section of sections) for (const field of section.fields) {
      const active = !section.categories || section.categories.includes(category);
      assert.deepEqual(detail.fields[field.key], active ? original.fields[field.key] : field.type === "chips" ? [] : "", field.key);
    }
    assert.deepEqual(form, original);
    assert.deepEqual(accepted(detail), detail, "normalization is idempotent");
    detail.fields.bio_cond.pop(); assert.deepEqual(form.fields.bio_cond, schema.bio_cond.options);
  });
  check(`${category}: category-specific required fields and corrective decision only where required`, () => {
    const form = valid(category);
    accepted(form);
    for (const field of sections.filter((section) => !section.categories || section.categories.includes(category)).flatMap((section) => section.fields).filter((field) => field.required)) {
      const missing = structuredClone(form); missing.fields[field.key] = ""; rejected(missing, field.key);
    }
    form.fields.bio_ca = "";
    if (["exp", "inj", "nm"].includes(category)) rejected(form, "decision required"); else accepted(form);
    form.fields.bio_ca = "Yes";
    rejected(form, "Yes requires action owner and due date");
    Object.assign(form.fields, { bio_action: "Record agreed control change", bio_owner: "Ecologist", bio_due: "2026-12-01" });
    accepted(form);
    for (const key of ["bio_action", "bio_owner", "bio_due"]) {
      const missing = structuredClone(form); delete missing.fields[key]; rejected(missing, key);
    }
  });
}
check("Other hazard requires description and an explicitly recorded hotspot requires a decision", () => {
  const form = valid(); form.fields.bio_haz = "Other (describe)"; rejected(form, "Other");
  form.fields.bio_ident = "  Observed unidentified vector  "; assert.equal(accepted(form).fields.bio_ident, "Observed unidentified vector");
  form.fields.bio_hot = schema.bio_hot.options[0]; rejected(form, "hotspot decision");
  form.fields.bio_ca = "No — existing controls adequate"; accepted(form);
});
check("draft mode permits unanswered fields but retains strict document/types/enums and blanks hidden data", () => {
  rejected(empty(), "empty submission");
  assert.deepEqual(accepted(empty(), { forSubmission: false }), empty());
  const draft = empty(); draft.fields.bio_worker = 1; rejected(draft, "bad draft type", { forSubmission: false });
  const changed = valid("obs");
  for (const section of sections.filter((section) => section.categories && !section.categories.includes("obs"))) for (const field of section.fields) changed.fields[field.key] = { hiddenMedical: "must disappear" };
  assert.deepEqual(accepted(changed), accepted(valid("obs")));
});
check("all supported select and chip options are accepted, including recorded first aid choices", () => {
  for (const section of sections) for (const field of section.fields.filter((field) => field.options)) {
    const category = section.categories?.[0] ?? "obs";
    for (const option of field.options) {
      const form = valid(category); form.fields[field.key] = field.type === "chips" ? [option] : option;
      if (field.key === "bio_haz" && option === "Other (describe)") form.fields.bio_ident = "Described vector";
      if (field.key === "bio_hot" || field.key === "bio_ca") Object.assign(form.fields, { bio_ca: "Yes", bio_action: "Agreed change", bio_owner: "Ecologist", bio_due: "2026-12-01" });
      assert.deepEqual(accepted(form).fields[field.key], form.fields[field.key]);
    }
    for (const invalid of ["invented option", 1, null, {}, ["extra"]]) {
      const form = valid(category); form.fields[field.key] = invalid; rejected(form, `${field.key} invalid enum/list`);
    }
  }
});
check("chip lists reject unknown/duplicate/excess/sparse/accessor/custom-property values", () => {
  for (const key of ["bio_cond", "bio_ppe", "bio_sym"]) {
    const choices = schema[key].options;
    const cases = [choices.concat(choices[0]), [choices[0], choices[0]], ["unknown"], [1], [null], new Array(1), Object.assign([choices[0]], { extra: "unsafe" })];
    const accessor = [choices[0]]; Object.defineProperty(accessor, "0", { get: () => { throw Error("Do not execute accessor"); } }); cases.push(accessor);
    for (const value of cases) { const form = valid(key === "bio_sym" ? "inj" : "obs"); form.fields[key] = value; rejected(form, key); }
  }
});
check("strict objects reject unsupported/admin/prototype/accessor keys without invoking getters", () => {
  for (const mutate of [
    (form) => { form.status = "Closed"; }, (form) => { form.documentCode = "EC-WHS-BIO-001"; },
    (form) => { form.documentRevision = "1"; }, (form) => { form.category = "unknown"; },
    (form) => { form.fields.bio_status = "Closed"; }, (form) => { form.fields.bio_id = "BIO-000001"; },
    (form) => { form.fields.bio_closer = "Spoofed"; }, (form) => { form.declaration.admin = true; },
    (form) => { form.fields = Object.create({ bio_worker: "Inherited" }); },
    (form) => { form.fields = JSON.parse('{"__proto__":{"admin":true}}'); },
    (form) => { form.fields.constructor = "bad"; }, (form) => { form.declaration.prototype = "bad"; },
    (form) => { form[Symbol("hidden")] = true; },
    (form) => { Object.defineProperty(form, "category", { enumerable: true, get() { throw Error("Getter executed"); } }); },
    (form) => { Object.defineProperty(form.fields, "bio_worker", { enumerable: true, get() { throw Error("Getter executed"); } }); },
    (form) => { Object.defineProperty(form.declaration, "signature", { enumerable: true, get() { throw Error("Getter executed"); } }); },
  ]) { const form = valid(); mutate(form); rejected(form, "strict keys/objects"); }
  for (const value of [null, [], true, 7, "text", new Date()]) {
    rejected(value, "top-level type");
    for (const key of ["fields", "declaration"]) { const form = valid(); form[key] = value; rejected(form, key); }
  }
});
check("every date is an actual ISO calendar date including leap years, and time is HH:mm", () => {
  for (const [key, category] of [["bio_date", "obs"], ["bio_due", "obs"], ["bio_fu", "exp"], ["declaration", "obs"]]) {
    const set = (form, value) => key === "declaration" ? form.declaration.date = value : form.fields[key] = value;
    for (const value of ["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]) { const form = valid(category); set(form, value); accepted(form); }
    for (const value of ["2023-02-29", "1900-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "2026-1-01", "not a date", "2026-11-06T10:00"]) { const form = valid(category); set(form, value); rejected(form, `${key} ${value}`); }
  }
  for (const value of ["00:00", "23:59", "12:30"]) { const form = valid(); form.fields.bio_time = value; accepted(form); }
  for (const value of ["24:00", "23:60", "9:05", "12:00:00", "midday"]) { const form = valid(); form.fields.bio_time = value; rejected(form, value); }
});
check("counts accept zero and nonnegative integers as strings, reject negatives/nonfinite/unsafe values", () => {
  for (const key of ["bio_num", "bio_count"]) {
    for (const value of ["", "0", "001", "250", "9007199254740991"]) { const form = valid("exp"); form.fields[key] = value; assert.equal(accepted(form).fields[key], value); }
    for (const value of ["-1", "1.5", "1e3", "NaN", "Infinity", "9007199254740992", "1x", 0, -1, Infinity]) { const form = valid("exp"); form.fields[key] = value; rejected(form, `${key} ${value}`); }
  }
});
check("all text/textarea fields enforce 200/4000 limits without silently truncating active fields", () => {
  for (const section of sections) for (const field of section.fields.filter((field) => ["text", "textarea"].includes(field.type))) {
    const form = valid(section.categories?.[0] ?? "obs"), limit = field.type === "textarea" ? 4000 : 200;
    form.fields[field.key] = "x".repeat(limit); assert.equal(accepted(form).fields[field.key].length, limit);
    form.fields[field.key] += "x"; rejected(form, field.key);
    form.fields[field.key] = null; rejected(form, `${field.key} null`);
  }
  const form = valid(); form.declaration.name = "x".repeat(200); accepted(form); form.declaration.name += "x"; rejected(form, "declaration length");
});
check("declaration name/date/captured PNG are mandatory; malformed, spoofed and oversized signatures fail", () => {
  for (const key of ["name", "date", "signature"]) { const form = valid(); form.declaration[key] = ""; rejected(form, key); }
  for (const value of [null, {}, [], 1, "Alex Example", "data:image/png;base64,c2lnbmF0dXJl", signature.replace("image/png", "image/jpeg"), signature.slice(0, -8), signature + "=", "data:image/png;base64,!!!!", "x".repeat(360001), `${signature}${" ".repeat(360001)}`]) {
    const form = valid(); form.declaration.signature = value; rejected(form, "bad signature");
  }
  const invalidMagic = Buffer.from(signature.split(",")[1], "base64"); invalidMagic[0] = 0;
  const invalidDimensions = Buffer.from(signature.split(",")[1], "base64"); invalidDimensions.fill(0, 16, 20);
  for (const bytes of [invalidMagic, invalidDimensions]) { const form = valid(); form.declaration.signature = `data:image/png;base64,${bytes.toString("base64")}`; rejected(form, "invalid PNG envelope"); }
  accepted(valid());
});

function row(category, location, project, hazard = "Ticks", date = "2026-11-06", extra = {}) {
  return { id: "row-id", details: { category, fields: { bio_loc: location, bio_proj: project, bio_haz: hazard, bio_date: date, ...extra } } };
}
check("hotspots group normalized location+project, safely handle delimiter collisions and apply all thresholds", () => {
  const rows = [
    row("obs", "  Creek\n crossing  ", "Survey", "Ticks", "2026-11-01"),
    row("pot", "CREEK CROSSING", " survey ", "Leeches", "2026-11-05"),
    row("nm", "Creek crossing", "Ｓｕｒｖｅｙ", "Ticks", "2026-11-03"),
    row("exp", "Exposure", "Project", "Ticks"), row("inj", "exposure", "project", "Mosquitoes"),
    row("obs", "Explicit", "Project", "Ticks", "2026-11-02", { bio_hot: schema.bio_hot.options[0] }),
    row("obs", "Single", "Project", "Ticks", "2026-02-30"),
    row("pot", "a|b", "c"), row("pot", "a", "b|c"), row("exp", "Creek crossing", "Other project"),
  ];
  const original = structuredClone(rows), grouped = hotspots(rows);
  assert.equal(grouped.length, 7);
  const creek = grouped.find((group) => group.location === "Creek crossing" && group.project === "Survey");
  assert.deepEqual(creek, { location: "Creek crossing", project: "Survey", hazards: ["Ticks", "Leeches"], entries: 3, exposures: 0, lastRecorded: "2026-11-05", hotspot: true });
  assert.equal(grouped.find((group) => group.location === "Exposure").hotspot, true);
  assert.equal(grouped.find((group) => group.location === "Explicit").hotspot, true);
  assert.equal(grouped.find((group) => group.location === "Single").lastRecorded, "");
  assert.equal(grouped.find((group) => group.project === "Other project").hotspot, false);
  assert.deepEqual(rows, original);
  assert.deepEqual(hotspots(null), []); assert.deepEqual(hotspots([null, {}, { details: null }]), []);
  assert.equal(hotspots([row("exp", "X", "Y"), row("pot", "X", "Y")])[0].hotspot, false);
});
check("hotspot output has only safe aggregate keys and never medical/person/photo data", () => {
  const privateRow = row("inj", "Site", "Project", "Ticks", "2026-11-06", { bio_worker: "PRIVATE WORKER", bio_ident: "PRIVATE IDENTIFICATION", bio_sym: ["PRIVATE SYMPTOM"], bio_meddet: "PRIVATE TREATMENT", bio_fudet: "PRIVATE FOLLOWUP", bio_photo: "PRIVATE PHOTO" });
  privateRow.details.declaration = { name: "PRIVATE NAME", signature: "PRIVATE SIGNATURE" };
  privateRow.photos = ["PRIVATE PHOTO"];
  const groups = hotspots([privateRow]);
  assert.deepEqual(Object.keys(groups[0]), ["location", "project", "hazards", "entries", "exposures", "lastRecorded", "hotspot"]);
  assert.doesNotMatch(JSON.stringify(groups), /PRIVATE/);
});

// CSV parser handles quoted commas, double quotes and embedded CR/LF so tests
// count actual records rather than incorrectly counting newline characters.
function parseCsv(text) {
  const records = []; let record = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { record.push(value); value = ""; }
    else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(value); records.push(record); record = []; value = "";
    } else value += char;
  }
  record.push(value); records.push(record); return records;
}
check("CSV preserves every signed field, declaration and all rows/long multiline text with correct escaping", () => {
  const full = valid("inj");
  for (const field of fields) full.fields[field.key] = field.type === "chips" ? [...field.options] : `Original ${field.key}: commas, and \"quotes\"\nsecond line\r\nlast line`;
  full.fields.bio_meddet += "x".repeat(10000);
  const rows = Array.from({ length: 1205 }, (_, index) => ({ id: `id-${index}`, register_number: `BIO-${index}`, details: structuredClone(full), status: "Open", admin_notes: `Internal, \"note\" ${index}\ncontinued` }));
  const before = structuredClone(rows), records = parseCsv(csv(rows)), headers = records[0];
  assert.equal(records.length, rows.length + 1);
  for (let index = 0; index < rows.length; index += 1) {
    assert.equal(records[index + 1][headers.indexOf("ID")], `id-${index}`);
    assert.equal(records[index + 1][headers.indexOf("Admin notes")], rows[index].admin_notes);
  }
  for (const field of fields) assert.equal(records[1][headers.indexOf(field.label)], field.type === "chips" ? JSON.stringify(full.fields[field.key]) : full.fields[field.key], field.key);
  assert.equal(records[1][headers.indexOf("Category")], "Injury / illness incident");
  assert.equal(records[1][headers.indexOf("Signature")], signature);
  assert.equal(records[1][headers.indexOf("Declaration name")], full.declaration.name);
  assert.equal(records[1][headers.indexOf("Declaration date")], full.declaration.date);
  assert.deepEqual(rows, before);
  assert.equal(parseCsv(csv([])).length, 1);
  assert.equal(parseCsv(csv([null, {}, { details: null }])).length, 4, "even blank rows are not filtered out");
});
check("CSV neutralizes Excel formulas even behind whitespace/control characters without losing original text", () => {
  const payloads = ['=HYPERLINK("https://example.test")', "+cmd", "-123", "@SUM(1,2)", "  =1+1", "\t=1+1", "\r=1+1", "\n=1+1", "\u0000=1+1", "\ufeff@x", "\tordinary text", "plain, \"text\"\nmultiline"];
  const rows = payloads.map((value) => ({ id: value, admin_notes: value, details: { category: "obs", fields: { bio_worker: value } } }));
  const records = parseCsv(csv(rows)), headers = records.shift();
  for (let index = 0; index < payloads.length; index += 1) for (const label of ["ID", "Admin notes", "Worker name"]) {
    assert.equal(records[index][headers.indexOf(label)], index === payloads.length - 1 ? payloads[index] : `'${payloads[index]}`);
  }
});

for (const [label, passed] of results) console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
const failures = results.filter(([, passed]) => !passed).length;
console.log(`\nBiological hazard model: ${results.length - failures}/${results.length} checks passed.`);
if (failures) process.exitCode = 1;
