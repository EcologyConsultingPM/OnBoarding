import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/private-daily-database-backup.yml", import.meta.url), "utf8");

assert.match(workflow, /SUPABASE_POOLER_DB_URL/, "The workflow must continue to prefer an explicitly configured pooler URL.");
assert.match(workflow, /project-qualified username/, "The workflow must document why the pooler username differs from the direct database username.");
assert.match(workflow, /from urllib\.parse import quote, unquote, urlsplit, urlunsplit/, "The workflow must parse connection URLs safely rather than using partial string replacement.");
assert.match(workflow, /quote\(f"postgres\.\{project_ref\}", safe=""\)/, "The derived pooler URL must use Supabase’s required project-qualified postgres username.");
assert.match(workflow, /password = quote\(unquote\(parts\.password or ""\), safe=""\)/, "The derived pooler URL must preserve an already URL-encoded password exactly once.");
assert.match(workflow, /aws-0-ap-south-1\.pooler\.supabase\.com/, "The derived pooler URL must target the connected project region’s IPv4-capable pooler endpoint.");
assert.doesNotMatch(workflow, /sed -E 's#:\/\/postgres:/, "The unsafe host-only pooler conversion must not be restored.");

console.log("Backup workflow pooler contract passed: direct URLs convert to an IPv4-capable pooler URL with the required project-qualified username.");
