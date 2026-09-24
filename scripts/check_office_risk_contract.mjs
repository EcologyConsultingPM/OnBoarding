import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const moduleSource = read("lib/officeRiskChecklist.js");
const checklist = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);
const component = read("components/OfficeRiskAssessmentForm.js");
const styles = read("lib/officeRiskStyles.js");
const route = read("app/api/whs-forms/route.js");
const reference = read("public/resources/whs/EC-Office-Risk-Assessment.html");

assert.equal(checklist.OFFICE_RISK_CHECKLIST.length, 13, "Office Risk checklist must retain 13 categories");
assert.equal(checklist.OFFICE_RISK_ITEM_IDS.length, 93, "Office Risk checklist must retain 93 controlled items");
assert.equal(new Set(checklist.OFFICE_RISK_ITEM_IDS).size, 93, "Office Risk item IDs must be unique");
assert.match(component, /Could this issue injure someone\?/);
assert.match(component, /Does someone need to fix or improve it\?/);
assert.match(component, /OFFICE_RISK_ITEM_IDS/);
assert.match(component, /version: 2/);
assert.match(component, /OFFICE_RISK_STYLE/);
assert.match(styles, /#0b2f1e/, "Office Risk Assessment should use the shared deep-green WHS header.");
assert.match(styles, /#e7c979/, "Office Risk Assessment should use the shared controlled-document gold accent.");
assert.match(styles, /@media \(max-width: 560px\)/, "Office Risk Assessment should preserve the staff portal mobile layout.");
assert.match(route, /normaliseOfficeRiskDetails/);
assert.match(route, /OFFICE_RISK_ITEM_IDS/);
assert.doesNotMatch(reference, /5 — ADMINISTRATIVE/);
assert.doesNotMatch(reference, /320 lux/);
console.log("Office Risk Assessment contract passed.");
