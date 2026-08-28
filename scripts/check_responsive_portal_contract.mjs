import fs from "node:fs";

const component = fs.readFileSync("components/WhsEcFormsDomain.js", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");
const layout = fs.readFileSync("app/layout.js", "utf8");
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
    "the root layout declares a device-width mobile viewport",
    /width:\s*"device-width"[\s\S]*?initialScale:\s*1/.test(layout),
  ],
  [
    "mobile Staff and Admin domain-card grids are forced into one vertical full-width column",
    /\/\* Mobile home dashboard card stack:[\s\S]*?@media \(max-width: 900px\)[\s\S]*?\.staff-home-grid[\s\S]*?\.staff-domain-grid[\s\S]*?\.admin-tile-grid[\s\S]*?\.admin-domain-grid[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) !important/.test(css),
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
