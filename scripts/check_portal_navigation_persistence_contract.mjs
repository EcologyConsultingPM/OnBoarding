import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const auth = await read("lib/AuthProvider.js");
const workbook = await read("components/OnboardingWorkbook.js");
const navigation = await read("components/WorkspaceNav.js");
const learningAssignments = await read("app/api/learning-assignments/route.js");
const learningAssignmentStatus = await read("app/api/learning-assignments/[assignmentId]/route.js");

assert.match(auth, /const sameUser = newSession\?\.user\?\.id && newSession\.user\.id === sessionUserIdRef\.current;/, "Auth events must identify same-user credential refreshes.");
assert.match(auth, /if \(sameUser\) \{\s*setSession\(newSession\);\s*return;\s*\}/, "Any same-user auth event must refresh credentials without re-gating the portal.");
assert.ok(!auth.includes('if (event === "TOKEN_REFRESHED" && sameUser)'), "Same-user SIGNED_IN and INITIAL_SESSION events must not remount the portal.");
assert.match(auth, /setAdminChecked\(false\);\s*syncPortalFromStorage\(\);\s*checkAdmin\(newSession\);/, "A genuine identity change must still re-check portal access.");

assert.match(workbook, /window\.localStorage\.setItem\(portalLocationKey, nextMode\)/, "The active domain must be saved independently for each portal.");
assert.match(workbook, /url\.searchParams\.set\("workspace", nextMode\)/, "The active domain must be retained in the browser URL.");
assert.match(workbook, /Deliberately do not listen for focus or storage events here/, "Portal navigation must not be replaced when another tab or window changes.");
assert.match(navigation, /workspace\", workspace/, "Direct workspace pages must carry the active domain back to the portal.");
assert.match(learningAssignments, /href: "\/\?workspace=ldlibrary"/, "Learning assignment notifications must open the supported learning workspace.");
assert.match(learningAssignmentStatus, /href: "\/\?workspace=ldlibrary"/, "Learning assignment status notifications must open the supported learning workspace.");
assert.ok(!learningAssignments.includes("workspace=learning"), "Learning assignment notifications must not target the obsolete workspace name.");
assert.ok(!learningAssignmentStatus.includes("workspace=learning"), "Learning status notifications must not target the obsolete workspace name.");

console.log("Portal navigation persistence contract passed: same-user auth updates preserve the active page, nested state, and return context.");
