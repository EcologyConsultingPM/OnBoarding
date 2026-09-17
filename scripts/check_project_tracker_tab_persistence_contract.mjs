import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const trackerPath = path.join(root, "components", "StaffProjectTracker.js");
const source = fs.readFileSync(trackerPath, "utf8");

const checks = [
  [source.includes('const TRACKER_LOCATION_KEY = "ec-staff-project-tracker-location"'), "tracker location is stored per browser tab"],
  [source.includes("window.sessionStorage.setItem(TRACKER_LOCATION_KEY"), "selected project and tracker tab are persisted"],
  [source.includes("const accessTokenRef = useRef"), "latest access token is held without rebuilding loaders"],
  [source.includes("Authorization: `Bearer ${accessTokenRef.current}`"), "requests use the current token"],
  [source.includes("const headers = useCallback(") && source.includes("\n    [],\n  );"), "request headers callback stays stable during token refresh"],
  [source.includes("writeTrackerLocation(form.projectId, activeTab)"), "tracker location updates when navigation changes"],
  [source.includes("const savedProjectId = readTrackerLocation().projectId"), "saved project is restored after a genuine remount"],
  [!source.includes("}, [headers, initialProjectId, session?.access_token]);"), "token refresh no longer triggers the main tracker reload"],
  [!source.includes("}, [headers, session?.access_token]);"), "token refresh no longer triggers the board reload"],
];

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
if (failed.length) process.exit(1);
console.log("Project Tracker tab-persistence contract passed.");
