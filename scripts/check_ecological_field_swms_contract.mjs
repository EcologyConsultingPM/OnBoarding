import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

const controls = await read("lib/ecologicalFieldSwms.js");
const staffForm = await read("components/EcologicalFieldSwmsForm.js");
const staffForms = await read("components/StaffForms.js");
const whsRoute = await read("app/api/whs-forms/route.js");
const governanceSource = await read("app/api/governance-source/route.js");
const governance = await read("components/InternalGovernance.js");
const compliance = await read("app/api/whs-compliance/route.js");
const schema = await read("lib/formSchemas.js");
const migration = await read("sql/2026-09-24-ecological-field-swms.sql");
const template = await read("controlled-documents/internal-generic-swms/EC-GEN-SWMS-001-ecological-field-surveys.md");

const sourceCodes = ["EC-SWMS01", "EC-SWMS04", "EC-SWMS06", "EC-SWMS08", "EC-SWMS12", "EC-SWMS15", "EC-SWMS16", "EC-SWMS18"];
for (const sourceCode of sourceCodes) {
  assert.match(controls, new RegExp(`documentCode: \\"${sourceCode}\\"`), `${sourceCode} must be selectable from the daily ecological SWMS.`);
  assert.match(governanceSource, new RegExp(`\\"${sourceCode}\\"`), `${sourceCode} must be available from the controlled governance document endpoint.`);
  assert.match(migration, new RegExp(`controlled:${sourceCode}`), `${sourceCode} must be seeded into Internal Generic SWMS.`);
}

assert.match(controls, /normaliseEcologicalFieldSwmsDetails/, "The daily selector must be normalised server-side.");
assert.match(controls, /if \(!selectedHazards\.length && details\.noSpecialistHazardConfirmed !== true\)/, "The selector must require a hazard decision.");
assert.match(controls, /if \(team\.some\(\(member\) => !member\.role \|\| !member\.acknowledged\)\)/, "Every listed worker must acknowledge the briefing.");
assert.ok(controls.includes('signature.startsWith("data:image/png;base64,")'), "The Field Lead must sign before submission.");
assert.match(controls, /Ecology Consulting personnel do not perform confined-space rescue/, "The confined-space control must preserve the rescue restriction.");
assert.match(controls, /No diving or unauthorised water rescue/, "The water control must preserve the no-diving and rescue restriction.");

assert.match(staffForm, /Open controlled SWMS/, "The staff form must let staff open each selected controlled source document.");
assert.match(staffForm, /Controls, authorisations, training, PPE and equipment are confirmed/, "The staff form must require selected control confirmation.");
assert.match(staffForm, /Stop-work triggers and safe retreat\/muster arrangements were briefed/, "The staff form must require stop-work briefing confirmation.");
assert.match(staffForms, /EcologicalFieldSwmsForm/, "The bespoke daily selector must be reachable in the WHS and EC Forms portal.");
assert.match(schema, /"ecological_field_swms"/, "The staff form must appear in the Field and mobilisation forms list.");

assert.match(whsRoute, /"ecological_field_swms"/, "The API must accept the ecological field SWMS record type.");
assert.match(whsRoute, /normaliseEcologicalFieldSwmsDetails/, "The API must validate the ecological field SWMS before saving it.");
assert.match(whsRoute, /ecological_field_swms_submitted/, "The submitted ecological SWMS must be reported to WHS monitoring administrators.");
assert.match(compliance, /ecological_field_swms: "Ecological Field Survey SWMS"/, "Compliance metrics must label ecological SWMS submissions professionally.");
assert.match(governance, /document\.document_link\?\.startsWith\("controlled:"\)/, "Internal Governance must securely open repository-controlled documents.");
assert.match(governance, /internal_generic_swms/, "Internal Governance must expose the dedicated Internal Generic SWMS folder.");
assert.match(governanceSource, /requirePortalResource/, "Controlled SWMS source documents must be access-controlled.");
assert.match(template, /This form does \*\*not\*\* replace a selected source SWMS/, "The generic controlled template must state its limits.");

console.log("Ecological field SWMS contract passed.");
