import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const component = read("components/FirstAidKitChecks.js");
const route = read("app/api/first-aid-kit-checks/route.js");
const sql = read("sql/2026-09-16-first-aid-kit-checks.sql");
const checks = [
  ["component fixes bearer interpolation", component, 'Authorization: `Bearer ${session?.access_token || ""}`'],
  ["component sends idempotency key", component, '"Idempotency-Key": idempotencyKey'],
  ["component conditionally selects all three kits", component, "KIT_LABELS = { A:"],
  ["component captures kit numbers", component, "Kit number (Kit {code})"],
  ["component captures check type and next due date", component, "Next check due"],
  ["component captures checker name and position", component, "Checked by — full name"],
  ["component generates controlled Kit A inventory refs", component, "ref: `A${index + 1}`"],
  ["component generates controlled Kit B inventory refs", component, "ref: `B${index + 1}`"],
  ["component generates controlled Kit C inventory refs", component, "ref: `C${index + 1}`"],
  ["component includes all four specified outcomes", component, "Failed — kit removed from service"],
  ["component requires action for failed items", component, "Complete its restock or removal action"],
  ["component integrates SignaturePad", component, 'import SignaturePad from "./SignaturePad"'],
  ["component has print/save PDF control", component, "Print / Save PDF"],
  ["component provides accessible error role", component, 'role="alert"'],
  ["component provides touch-sized check targets", component, "min-height:52px"],
  ["route enforces staff.forms authorization", route, '"staff.forms"'],
  ["route permits admins through WHS authorization", route, '"admin.whs"'],
  ["route limits staff GET to own checks", route, '.eq("checked_by", access.user.id)'],
  ["route limits payload bytes", route, "MAX_REQUEST_BYTES"],
  ["route validates controlled inventories", route, "canonical"],
  ["route validates action for every non-OK item", route, "needs a restock or removal action"],
  ["route uses idempotency key", route, "idempotency_key"],
  ["route handles idempotency conflict", route, '"23505"'],
  ["route makes notifications non-fatal", route, "First aid kit notification failed"],
  ["route uses valid root portal notification href", route, 'href: "/?portal=admin&area=whsmonitor"'],
  ["migration persists Rev 1 fields", sql, "selected_kits jsonb"],
  ["migration creates idempotency unique index", sql, "first_aid_kit_checks_submitter_idempotency_key"],
  ["migration enables RLS", sql, "enable row level security"],
  ["migration protects staff records", sql, "checked_by = auth.uid() or is_admin()"],
];

let failures = 0;
for (const [label, source, expected] of checks) {
  const passed = source.includes(expected);
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) failures += 1;
}
for (const [label, sample] of [["Kit A", "AEROWOUND™ BPC Wound Dressing"], ["Kit B", "Emergency First Aid Information Booklet"], ["Kit C", "Snake and Spider Bite Guide"]]) {
  const passed = route.includes(sample) && route.includes("items.length !== canonical[kit.kit].length");
  console.log(`${passed ? "PASS" : "FAIL"}  route validates complete ${label} inventory`);
  if (!passed) failures += 1;
}
if (component.includes("Bearer \\${session")) {
  console.log("FAIL  component does not retain escaped bearer interpolation");
  failures += 1;
} else {
  console.log("PASS  component does not retain escaped bearer interpolation");
}
if (failures) process.exitCode = 1;
