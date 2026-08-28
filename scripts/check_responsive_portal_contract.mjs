import fs from "node:fs";

const component = fs.readFileSync("components/WhsEcFormsDomain.js", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");
const requirements = [
  [
    "WHS no longer renders a simulated device frame",
    !/whs-device-preview-shell|whs-device-frame|DEVICE_VIEWS/.test(component),
  ],
  [
    "WHS forms use a full-width device-adaptive content container",
    /className="whs-domain__content"/.test(component),
  ],
  [
    "WHS content has tablet breakpoint coverage",
    /@media \(max-width: 1040px\)[\s\S]*?\.whs-domain__content/.test(css),
  ],
  [
    "WHS content has mobile breakpoint coverage",
    /@media \(max-width: 760px\)[\s\S]*?\.whs-domain__content/.test(css),
  ],
  [
    "WHS content has narrow-phone breakpoint coverage",
    /@media \(max-width: 480px\)[\s\S]*?\.whs-domain__content/.test(css),
  ],
  [
    "portal shell blocks horizontal canvas overflow",
    /\.ec-portal-shell\s*\{[\s\S]*?overflow-x:\s*clip/.test(css),
  ],
  [
    "wide data tables can scroll inside their own container",
    /\.ec-portal-shell \.table-wrap,[\s\S]*?overflow-x:\s*auto/.test(css),
  ],
  [
    "existing portal stylesheet includes general tablet and mobile breakpoints",
    /@media \(max-width: 900px\)/.test(css) && /@media \(max-width: 640px\)/.test(css),
  ],
];

const failures = requirements.filter(([, passed]) => !passed).map(([label]) => label);
for (const [label, passed] of requirements) {
  console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
}
if (failures.length) {
  console.error(`\nResponsive contract failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nResponsive portal contract passed.");
