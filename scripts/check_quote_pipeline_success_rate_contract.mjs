import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

const route = await read("app/api/quote-pipeline/route.js");
const dashboard = await read("components/AdminQuotePipeline.js");

assert.match(route, /const sent = live\.filter\(\(r\) => r\.initial_sent\)\.length;/, "The rolling cohort must count every live quote sent in the period.");
assert.match(route, /successRate: sent \? Math\.round\(\(successful\.length \/ sent\) \* 100\) : 0/, "Success rate must equal successful quotes divided by all quotes sent in the 30-day cohort.");
assert.doesNotMatch(route, /successful\.length \/ decided/, "Success rate must not use only finalised quote decisions as its denominator.");
assert.match(route, /Pending and withdrawn quotes\s+\/\/ therefore remain in the denominator/, "The cohort definition must document pending and withdrawn quote treatment.");
assert.match(dashboard, /Successful ÷ sent · 30 days/, "The dashboard KPI must clearly identify the success-rate formula.");

console.log("Quote pipeline success-rate contract passed.");
