import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const sources = await read("lib/ecado/sources.js");
const collector = await read("lib/ecado/collect.js");
const briefRoute = await read("app/api/ecado/brief/route.js");
const consoleView = await read("components/ecado/EcadoConsole.js");

assert.match(sources, /assignedTo: "staff_user_id"/, "Ecado must map live work activity assignments through staff_user_id.");
assert.doesNotMatch(sources, /owner: "assigned_to", surveyWindowEnd/, "Ecado must not query the retired project activity assigned_to field.");
assert.match(sources, /deliverables: source\("project_deliverables"/, "Ecado must collate live project deliverables.");
assert.match(sources, /certifications: source\("staff_certifications"/, "Ecado must collate staff certification records.");
assert.match(sources, /quotes: source\("quote_drafts"/, "Ecado must collate live quote drafts rather than an obsolete quotes table.");
assert.match(sources, /capacity: source\("project_activities \+ staff_capacity_profiles"/, "Ecado must have a derived capacity source based on live workload records.");
assert.match(sources, /\(options\.derived \? \{ derived: true \} : \{\}\)/, "The source registry must preserve derived-feed metadata.");
assert.match(collector, /async function readCapacityFeed/, "Ecado must calculate a read-only weekly capacity feed.");
assert.match(collector, /SOURCES\[name\]\?\.derived/, "Ecado must dispatch derived sources to their collector rather than query a non-existent table.");
assert.match(briefRoute, /function sourceSummary\(snapshot\)/, "Ecado refreshes must return a source-level collation summary.");
assert.match(briefRoute, /sources: refreshedSources/, "Ecado refresh responses must include source currency and status.");
assert.doesNotMatch(briefRoute, /temperature:\s*0/, "Ecado narration requests must not send the deprecated temperature parameter.");
assert.match(consoleView, /Refresh & collate data/, "Ecado must provide an explicit refresh control.");
assert.match(consoleView, /narrate: refreshOnly \? false : undefined/, "The refresh control must use deterministic collation rather than optional narration.");
assert.match(consoleView, /\/api\/ecado\/escalations\/close/, "Ecado refresh must reload the authoritative open escalation register.");
assert.match(consoleView, /Latest source check/, "Ecado must visibly report the latest source collation outcome.");
assert.match(consoleView, /This does not change source records/, "Ecado must explain that refresh does not modify operational source data.");

console.log("Ecado refresh contract passed: live sources, derived capacity, deterministic refresh, source status, and narration compatibility are protected.");
