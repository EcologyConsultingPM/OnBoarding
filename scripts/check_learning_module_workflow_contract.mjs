import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const assignmentCreate = read("app/api/learning-assignments/route.js");
const assignmentUpdate = read("app/api/learning-assignments/[assignmentId]/route.js");
const nodeRoute = read("app/api/ld/[nodeId]/route.js");
const panel = read("components/LearningAssignmentsPanel.js");
const detail = read("components/LearningModuleDetail.js");

expect(assignmentCreate.includes('"action_required"'), "Assigned-learning events must use a permitted action_required severity.");
expect(assignmentUpdate.includes('current.status !== "assessed"'), "Competency verification must follow assessment.");
expect(assignmentUpdate.includes("submission_note"), "Learning submissions must retain staff evidence notes.");
expect(assignmentUpdate.includes('["assess", "verify", "return", "unlock"].includes(action) && !note'), "Assessment and competency authorisation must retain reviewer decision notes.");
expect(nodeRoute.includes("getModuleReadiness"), "Module approval must validate the structured learning checklist.");
expect(panel.includes("submissionNotes"), "Staff must be able to record evidence before submitting a module.");
expect(detail.includes("Completion is not authorisation"), "Module UI must distinguish completion from authorisation.");
expect(detail.includes("What must I escalate?"), "Module UI must include escalation guidance.");

if (failures.length) {
  console.error("Learning module workflow contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Learning module workflow contract passed.");
