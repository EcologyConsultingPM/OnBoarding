import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

const setup = await read("components/AdminProjectSetup.js");
const deliverablesRoute = await read("app/api/projects/[projectId]/deliverables/route.js");
const activitiesRoute = await read("app/api/projects/[projectId]/activities/route.js");
const styles = await read("app/globals.css");

assert.match(setup, /MANUAL_ACTIVITY_DELIVERABLE = "__manual_work_activities__"/, "Project Setup must identify the explicit Other choice.");
assert.match(setup, /Other — enter work activities manually/, "Project Setup must show an Other option in the deliverable selector.");
assert.match(setup, /deliverableType: "other_manual_activities"/, "The Other choice must create an identifiable manual deliverable.");
assert.match(setup, /goToStage\("activities"\)/, "The Other choice must move directly to Work Activities.");
assert.match(setup, /createBlankActivity\(d\.deliverable\.id\)/, "The Other choice must prepare a blank activity linked to the manual deliverable.");
assert.match(setup, /Custom activity plan:/, "Work Activities must distinguish the custom planning path.");
assert.match(setup, /Other — manual work activities/, "The saved Other deliverable must have a professional label.");
assert.match(setup, /deliverableId,/, "Manual activity state must carry its deliverable identity.");

assert.match(deliverablesRoute, /Plain manual deliverable, no template/, "Deliverable API must retain the manual-deliverable write path.");
assert.match(deliverablesRoute, /deliverable_type: body\?\.deliverableType \|\| null/, "Deliverable API must persist the custom deliverable type.");
assert.match(activitiesRoute, /availableDeliverableIds/, "Activity saves must verify their linked deliverable belongs to the project.");
assert.match(activitiesRoute, /deliverable_id: validId\(input\.deliverableId\) \? input\.deliverableId : null/, "Activity saves must preserve manual deliverable linkage.");
assert.match(activitiesRoute, /Choose an active deliverable from this project/, "Activity saves must reject cross-project or inactive deliverable links.");
assert.match(styles, /\.aps-manual-deliverable-choice/, "The Other choice must have dedicated professional visual styling.");
assert.match(styles, /\.aps-manual-activity-note/, "The manual Work Activities guidance must have dedicated styling.");

console.log("Project manual activity contract passed.");
