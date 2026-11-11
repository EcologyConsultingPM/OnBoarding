import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const workflow = await readFile(new URL("../.github/workflows/private-daily-database-backup.yml", import.meta.url), "utf8");
const healthRoute = await readFile(new URL("../app/api/admin/system-health/route.js", import.meta.url), "utf8");
const pythonMatch = workflow.match(/          python3 - <<'PY'\n([\s\S]*?)\n          PY/);
assert.ok(pythonMatch, "The actual connection selection must be exercised by the regression test.");
const python = pythonMatch[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
const ref = "qjsdglkipgncttztksxl";
const password = "dummy:P@ss/#?%&+ with space";
const encoded = encodeURIComponent(password);
const direct = `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`;
// Deliberately use a different cluster index to prove the host is never inferred.
const host = "aws-7-ap-south-1.pooler.supabase.com";
const pooler = `postgresql://postgres.${ref}:${encoded}@${host}:5432/postgres`;
let cases = 0;

async function select(db = "", explicit = "", expectedSuccess = true) {
  const dir = await mkdtemp(join(tmpdir(), "backup-contract-"));
  const envFile = join(dir, "github-env");
  try {
    const result = spawnSync("python3", ["-c", python], {
      env: { ...process.env, SUPABASE_DB_URL: db, SUPABASE_POOLER_DB_URL: explicit, GITHUB_ENV: envFile },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status === 0, expectedSuccess, "Unexpected connection selection outcome.");
    const safeLog = result.stdout.split("\n").filter((line) => !line.startsWith("::add-mask::")).join("\n") + result.stderr;
    assert.ok(!safeLog.includes(password) && !safeLog.includes(encoded), "Credentials must not appear outside GitHub mask commands.");
    cases++;
    if (!expectedSuccess) {
      assert.match(result.stderr, /::error::/);
      await assert.rejects(readFile(envFile), { code: "ENOENT" }, "Invalid configuration must not export a connection.");
      return;
    }
    const written = await readFile(envFile, "utf8");
    assert.equal(written.trim().split("\n").length, 1, "Only the selected connection may be exported.");
    assert.ok(written.startsWith("SUPABASE_DB_URL="));
    const selected = written.trim().slice("SUPABASE_DB_URL=".length);
    const maskEscape = (value) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    assert.ok(result.stdout.includes(`::add-mask::${maskEscape(selected)}\n`), "The exported URL must be masked before the next step logs its environment.");
    assert.ok(result.stdout.includes(`::add-mask::${maskEscape(password)}\n`), "The decoded password must be masked too.");
    const url = new URL(selected);
    assert.equal(url.hostname, host, "Use the exact configured pooler cluster.");
    assert.equal(url.port, "5432", "Logical backups must use session pooling.");
    assert.equal(url.username, `postgres.${ref}`);
    assert.equal(decodeURIComponent(url.password), password, "Decode/re-encode reserved characters exactly once.");
    assert.equal(url.searchParams.get("connect_timeout"), "20");
    assert.ok(["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")));
    return url;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await select(direct, pooler); // Explicit pooler overrides a direct secret.
await select(`postgresql://postgres.${ref}:stale@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, pooler); // Also overrides a stale pooler.
await select("", pooler); // Pooler-only configuration is valid.
await select(pooler); // Backward-compatible DB_URL already containing a pooler.
await select("malformed-direct-url", pooler); // A valid override stands alone.
await select(pooler.replace(":5432/", ":6543/")); // Same verified host/credentials, session port.
await select(pooler + "?sslmode=verify-full&application_name=ecology-backup");
await select("", "", false);
await select(direct, "", false); // Never guess the pooler host from the region.
await select(pooler.replace(`postgres.${ref}`, "postgres"), "", false);
await select(pooler.replace(ref, "wrongproject"), "", false);
await select(pooler.replace(":5432/", ":9999/"), "", false);
await select(pooler.replace(host, `${host}.attacker.example`), "", false);
await select(pooler.replace(encoded, "[YOUR-PASSWORD]"), "", false);
await select(pooler.replace(encoded, ""), "", false);
await select(pooler + "\nINJECTED=yes", "", false);
await select(pooler + "#fragment", "", false);
await select(pooler.replace("/postgres", "/other-database"), "", false);
await select(pooler + "?sslmode=disable", "", false);
await select(pooler + "?malformed", "", false);
await select(direct, "invalid-explicit-override", false); // Fail closed rather than use stale credentials.

const coverageMatch = healthRoute.match(/function coverageStatus\(run, now = Date\.now\(\)\) \{[\s\S]*?\n\}/);
assert.ok(coverageMatch);
const coverageStatus = vm.runInNewContext(`(${coverageMatch[0]})`);
const covered = { database_roles: true, database_schema: true, database_data: true, storage_objects: false };
const now = Date.now();
const fresh = { status: "succeeded", finished_at: new Date(now - 3600000).toISOString(), coverage: covered };
assert.equal(coverageStatus(fresh, now).database, true);
assert.equal(coverageStatus(fresh, now).storage, false);
assert.equal(coverageStatus({ ...fresh, finished_at: new Date(now - 31 * 3600000).toISOString() }, now).database, false, "Stale archives cannot display current coverage.");
assert.equal(coverageStatus({ ...fresh, finished_at: null }, now).database, false);
for (const status of ["failed", "running", undefined]) {
  assert.equal(coverageStatus({ ...fresh, status }, now).database, false, "Unsuccessful runs cannot display verified coverage.");
}
assert.equal(coverageStatus(null).database, false);
assert.equal(coverageStatus({ ...fresh, coverage: { ...covered, database_data: "true" } }, now).database, false);
assert.match(workflow, /version: 3\.0\.0/, "Pin the tested CLI release, not a drifting latest version.");
assert.doesNotMatch(workflow, /--db-url/, "Use the current CLI's --remote flag.");
assert.match(workflow, /retention-days: 1/);
assert.match(workflow, /MAX_ARCHIVE_BYTES: 104857600/);
assert.match(workflow, /trap 'rm -f backup\/roles\.sql/, "Partial plaintext dumps must be cleaned on failure too.");
assert.match(workflow, /BACKUP_STARTED_AT/, "Preserve the run start timestamp in outcome reports.");

console.log(`Backup workflow contract passed: ${cases} executable connection cases, credential masking, session pooling, TLS, and honest coverage reporting.`);
