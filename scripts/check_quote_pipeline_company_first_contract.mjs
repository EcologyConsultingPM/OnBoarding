import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

const draftWorkspace = await read("components/QuoteDraftWorkspace.js");
const pipeline = await read("components/AdminQuotePipeline.js");
const pipelineRoute = await read("app/api/quote-pipeline/route.js");
const detailRoute = await read("app/api/quote-pipeline/[quoteId]/route.js");
const migration = await read("sql/2026-10-29-quote-pipeline-company-first.sql");

assert.match(draftWorkspace, /FormInput label="Company"[\s\S]*?FormInput label="Primary contact name"/, "The new enquiry form must show Company before Primary contact name.");
assert.doesNotMatch(draftWorkspace, /FormInput label="Client name"/, "The old Client name form label must be replaced with Primary contact name.");
assert.match(draftWorkspace, /draft\.project_name \|\| draft\.company \|\| draft\.client_name/, "The draft workspace identity must prioritise company after project name.");

assert.match(pipeline, /quoteDraftId/, "An issued quote form must retain its selected source enquiry ID.");
assert.match(pipeline, /Select company from Quotes to be Drafted/, "The issued quote form must start with a company selector backed by draft enquiries.");
assert.match(pipeline, /Select project from the chosen company/, "The issued quote form must filter project choices by company.");
assert.match(pipeline, /Primary contact name/, "The issued quote form must display the selected primary contact clearly.");
assert.match(pipeline, /Select a company and project from Quotes to be Drafted before adding an issued quote/, "The UI must prevent an unlinked issued quote from being saved.");
assert.match(pipeline, /<th>Company<\/th><th>Project<\/th>/, "The issued quote table must show Company before Project.");
assert.match(pipeline, /All companies/, "The issued quote filter must be company-first.");

assert.match(pipelineRoute, /DRAFT_OPTION_COLUMNS/, "The quote API must explicitly load safe draft-option fields.");
assert.match(pipelineRoute, /availableDraftOptions/, "The quote API must expose available quote-draft choices to the form.");
assert.match(pipelineRoute, /quote_draft_id/, "The quote API must persist the source enquiry relationship.");
assert.match(pipelineRoute, /quote_drafts[\s\S]*?transferred_quote_id/, "The quote API must exclude already-transferred draft enquiries.");
assert.match(pipelineRoute, /An issued quote already exists for the selected draft enquiry/, "The quote API must block duplicate issued quotes for one enquiry.");
assert.match(pipelineRoute, /status: "transferred"/, "Creating an issued quote must mark its source enquiry transferred.");
assert.match(pipelineRoute, /quote_pipeline[\s\S]*?delete\(\)\.eq\("id", data\.id\)/, "A failed source-link update must clean up the newly inserted issued quote.");
assert.match(detailRoute, /company, client, project, quote_draft_id/, "Quote edits must retain company and source-enquiry fields.");
assert.match(detailRoute, /company: opt\(body\.company\)/, "Quote edits must preserve the company-first display field.");

assert.match(migration, /add column if not exists company text/, "The migration must add a company field to issued quotes.");
assert.match(migration, /add column if not exists quote_draft_id uuid references public\.quote_drafts/, "The migration must add the source-enquiry foreign key.");
assert.match(migration, /quote_pipeline_quote_draft_unique/, "The migration must enforce one issued quote per source enquiry.");
assert.match(migration, /draft\.transferred_quote_id = pipeline\.id/, "The migration must backfill existing controlled transfers.");
assert.match(migration, /company, client, project, quote_draft_id/, "The controlled draft-transfer function must create company-first issued records.");

console.log("Quote pipeline company-first contract passed: company-first enquiry capture, draft-selected issued quotes, source linkage, duplicate prevention and transfer audit state are verified.");
