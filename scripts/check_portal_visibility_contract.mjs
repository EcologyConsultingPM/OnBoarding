import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const checks = [
  ["resource catalogue has primary administrator", "lib/portalVisibility.js", 'PRIMARY_ADMIN_EMAIL = "aaron.dooley@ecologyconsulting.au"'],
  ["resource resolver inherits parent locks", "lib/portalVisibility.js", "explicitParentLock"],
  ["primary administrator cannot be locked", "app/api/portal-visibility/route.js", "The primary administrator always retains portal access."],
  ["management endpoint is Aaron-only", "app/api/portal-visibility/route.js", "Only Aaron Dooley can change staff portal visibility."],
  ["active Staff List is enforced", "app/api/portal-visibility/route.js", "activeOnly: true"],
  ["staff home filters locked domain cards", "components/OnboardingWorkbook.js", "visibility[domain.resourceKey] !== false"],
  ["admin home hides commercial card by default", "components/OnboardingWorkbook.js", 'resourceKey === "admin.quote_pipeline"'],
  ["admin cards provide eye controls", "components/OnboardingWorkbook.js", "portal-visibility-eye"],
  ["staff project tabs filter locked sub-domains", "components/StaffMyProjects.js", "visibleTabs"],
  ["quote list is server-protected", "app/api/quote-pipeline/route.js", 'requirePortalResource(access, "admin.quote_pipeline")'],
  ["quote edits are server-protected", "app/api/quote-pipeline/[quoteId]/route.js", 'requirePortalResource(access, "admin.quote_pipeline")'],
  ["remote operations is server-protected", "app/api/remote-ops/route.js", '"staff.remote_operations"'],
  ["service requests are server-protected", "app/api/service-requests/route.js", '"staff.projects.service_requests"'],
  ["timesheets are server-protected", "app/api/my-project-tracker/route.js", '"staff.timesheets"'],
  ["project tracker is server-protected", "app/api/project-tracker-entries/route.js", '"staff.projects.tracker"'],
  ["activity updates are server-protected", "app/api/my-activities/route.js", '"staff.projects.activities"'],
  ["learning library is server-protected", "app/api/ld/route.js", '"staff.learning"'],
  ["migration enables RLS", "sql/2026-08-28-portal-visibility-controls.sql", "alter table public.portal_visibility_overrides enable row level security;"],
];

let failures = 0;
for (const [label, relative, expected] of checks) {
  const passed = read(relative).includes(expected);
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) failures += 1;
}
if (failures) process.exitCode = 1;
