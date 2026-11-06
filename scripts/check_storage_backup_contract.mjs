import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const source = await readFile(new URL("app/api/cron/storage-backup/route.js", root), "utf8");
const workflow = await readFile(new URL(".github/workflows/private-daily-database-backup.yml", root), "utf8");
const statusSource = await readFile(new URL("app/api/cron/backup-status/route.js", root), "utf8");
const token = "test-backup-token-never-live";
const origin = "https://test-project.supabase.co";
const env = { BACKUP_STATUS_TOKEN: token, NEXT_PUBLIC_SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: "test-server-key" };
let clientCalls = 0;
let calls = [];
let buckets = [{ id: "private-photos", name: "private-photos", public: false }, { id: "public-assets", name: "public-assets", public: true }];
let rows = [];
let listError = false;
let signingError = false;
let signedHost = origin;
const client = { storage: {
  async listBuckets(options) {
    assert.equal(options.sortColumn, "id");
    assert.equal(options.sortOrder, "asc");
    assert.ok(options.limit <= 50);
    calls.push({ operation: "buckets", options });
    return { data: buckets.slice(options.offset, options.offset + options.limit), error: null };
  },
  async getBucket(id) {
    const found = buckets.find((item) => item.id === id);
    return found ? { data: found, error: null } : { data: null, error: { statusCode: "404" } };
  },
  from(bucket) {
    calls.push({ operation: "from", bucket });
    return {
      async list(prefix, options) {
        calls.push({ operation: "list", prefix, options });
        return { data: rows.slice(options.offset, options.offset + options.limit), error: listError ? { message: "do-not-leak-medical-path" } : null };
      },
      async createSignedUrls(paths, seconds) {
        calls.push({ operation: "sign", paths, seconds });
        return { data: paths.map((path) => ({ path, signedUrl: `${signedHost}/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}?token=test-signed-only` })).reverse(),
          error: signingError ? { message: "do-not-leak-medical-path" } : null };
      },
    };
  },
} };
const context = { crypto, Buffer, Response, URL, process: { env }, createClient(url, key, options) {
  clientCalls++;
  assert.equal(url, origin);
  assert.equal(key, "test-server-key");
  assert.equal(options.auth.persistSession, false);
  assert.equal(options.auth.autoRefreshToken, false);
  return client;
} };
vm.createContext(context);
vm.runInContext(source.replace(/^import .*;\n/gm, "").replace(/export /g, "") + "\nthis.get = GET;", context);
let cases = 0;
async function get(query = "", auth = `Bearer ${token}`, status = 200) {
  const response = await context.get(new Request(`https://app.example/api/cron/storage-backup${query}`, { headers: auth === null ? {} : { authorization: auth } }));
  assert.equal(response.status, status, `Unexpected endpoint status for case ${cases + 1}`);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("vary"), "Authorization");
  cases++;
  return response.json();
}
for (const auth of [null, "", "Bearer wrong", `Basic ${token}`, `Bearer ${token}x`]) await get("", auth, 401);
assert.equal(clientCalls, 0, "Unauthenticated requests must never enumerate storage.");
env.BACKUP_STATUS_TOKEN = "";
await get("", `Bearer ${token}`, 401);
env.BACKUP_STATUS_TOKEN = token;
assert.match(source, /crypto\.timingSafeEqual/);
assert.match(statusSource, /crypto\.timingSafeEqual/);
assert.doesNotMatch(source, /getPublicUrl|\.schema\(|\.rpc\(|ANON_KEY|request\.json/);

let result = await get();
assert.equal(result.buckets.length, 2);
assert.equal(result.buckets.find((bucket) => bucket.id === "private-photos").public, false);
assert.equal(result.storageOrigin, origin);
assert.equal(result.hasMore, false);
buckets = Array.from({ length: 55 }, (_, i) => ({ id: `bucket-${String(i).padStart(2, "0")}`, public: i % 2 === 0 }));
result = await get("?offset=0&limit=50");
assert.equal(result.buckets.length, 50);
assert.equal(result.hasMore, true);
result = await get("?offset=50&limit=50");
assert.equal(result.buckets.length, 5);
assert.equal(result.hasMore, false);
buckets = [{ id: "private-photos", public: false }, { id: "public-assets", public: true }];
for (const bucket of ["private-photos?x=1", "private-photos#fragment", "private-photos%2Fother"]) {
  const before = clientCalls;
  await get(`?bucket=${encodeURIComponent(bucket)}`, `Bearer ${token}`, 400);
  assert.equal(clientCalls, before, "Bucket identifiers cannot inject provider URL syntax.");
}
for (const query of ["?limit=51", "?limit=0", "?offset=10001", "?offset=-1", "?offset=1.5", "?bucket=../other", "?bucket=private-photos&prefix=../outside", "?bucket=private-photos&prefix=a//b", "?bucket=private-photos&prefix=a%5Cb", "?bucket=private-photos&prefix=%00", "?prefix=photos", "?bucket=private-photos&bucket=public-assets", "?unknown=1"]) {
  const before = clientCalls;
  await get(query, `Bearer ${token}`, 400);
  assert.equal(clientCalls, before);
}
result = await get("?bucket=missing", `Bearer ${token}`, 404);
assert.deepEqual(Object.keys(result), ["error"]);
const folder = { name: "nested", id: null, metadata: null };
const photo = { name: "photo one.jpg", id: "object-id", metadata: { size: 3, mimetype: "image/jpeg", owner_secret: "never-return-raw-metadata" }, updated_at: "2026-01-02T00:00:00Z" };
rows = [folder, photo];
calls = [];
result = await get("?bucket=private-photos&prefix=register&limit=2");
assert.equal(result.hasMore, true);
assert.equal(result.entries[0].path, "register/nested");
assert.equal(result.entries[0].isFolder, true);
assert.equal(result.entries[0].url, undefined);
assert.equal(result.entries[1].size, 3);
assert.equal(result.entries[1].mimeType, "image/jpeg");
assert.equal(result.entries[1].updated_at, photo.updated_at);
assert.equal(result.entries[1].id, "object-id");
assert.equal(result.entries[1].isFolder, false);
assert.equal(result.entries[1].metadata, undefined);
assert.equal(new URL(result.entries[1].url).origin, origin);
assert.equal(calls.find((call) => call.operation === "sign").seconds, 300);
assert.deepEqual(JSON.parse(JSON.stringify(calls.find((call) => call.operation === "list").options)), { limit: 2, offset: 0, sortBy: { column: "name", order: "asc" } });
result = await get("?bucket=private-photos&prefix=register&limit=2&offset=2");
assert.equal(result.hasMore, false);
assert.equal(result.entries.length, 0);
rows = [{ ...photo, name: "../escape" }];
await get("?bucket=private-photos", `Bearer ${token}`, 502);
rows = [{ ...photo, metadata: {} }];
await get("?bucket=private-photos", `Bearer ${token}`, 502);
rows = [photo];
listError = true;
result = await get("?bucket=private-photos", `Bearer ${token}`, 502);
assert.ok(!JSON.stringify(result).includes("do-not-leak"));
listError = false;
signingError = true;
await get("?bucket=private-photos", `Bearer ${token}`, 502);
signingError = false;
signedHost = "https://attacker.example";
await get("?bucket=private-photos", `Bearer ${token}`, 502);
signedHost = origin;
const configured = env.NEXT_PUBLIC_SUPABASE_URL;
env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co.attacker.example";
await get("", `Bearer ${token}`, 503);
env.NEXT_PUBLIC_SUPABASE_URL = configured;
env.SUPABASE_SERVICE_ROLE_KEY = "";
await get("", `Bearer ${token}`, 503);
env.SUPABASE_SERVICE_ROLE_KEY = "test-server-key";

// All Python I/O below is synthetic, local temp files; urllib is mocked and
// network use fails if any code unexpectedly tries to reach a live endpoint.
const python = String.raw`
import copy, hashlib, importlib.util, io, json, os, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request

spec = importlib.util.spec_from_file_location("storage_collector", "scripts/backup_storage_objects.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
ORIGIN = "https://test-project.supabase.co"
ENDPOINT = "https://app.example/api/cron/storage-backup"

def entry(name, prefix="", folder=False, data=b"abc"):
    path = (prefix + "/" if prefix else "") + name
    return {"name": name, "path": path, "isFolder": folder, "id": None if folder else "test-id", "size": None if folder else len(data),
            "mimeType": None if folder else "image/jpeg", "updated_at": "2026-01-02T00:00:00Z",
            **({} if folder else {"url": ORIGIN + "/storage/v1/object/sign/private-photos/" + b.quote(path, safe="/") + "?token=dummy"})}

class Fake:
    def __init__(self, listings=None, bucket_rows=None, payload=b"abc", mutate=None):
        self.listings = listings or {("private-photos", ""): [entry("nested", folder=True)], ("private-photos", "nested"): [entry("photo.jpg", "nested")]}
        self.buckets = bucket_rows if bucket_rows is not None else [{"id": "private-photos", "public": False}, {"id": "public-assets", "public": True}]
        self.payload, self.mutate, self.calls, self.downloads = payload, mutate, [], 0
    def page(self, **params):
        self.calls.append(params)
        key = "entries" if "bucket" in params else "buckets"
        source = self.listings.get((params.get("bucket"), params.get("prefix")), []) if key == "entries" else self.buckets
        offset = params["offset"]
        result = {"storageOrigin": ORIGIN, key: copy.deepcopy(source[offset:offset + b.PAGE_SIZE]), "hasMore": offset + b.PAGE_SIZE < len(source)}
        return self.mutate(result, params) if self.mutate else result
    def download(self, url, target, expected, budget):
        self.downloads += 1
        target.write_bytes(self.payload)
        return hashlib.sha256(self.payload).hexdigest(), len(self.payload)

class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ("roles.sql", "schema.sql", "data.sql"):
            (self.root / name).write_bytes(b"SQL")
    def tearDown(self):
        self.temp.cleanup()
    def run_collect(self, fake=None, **kwargs):
        return b.collect(self.root, ENDPOINT, "dummy", transport=fake or Fake(), **kwargs)
    def assert_failed(self, fake=None, **kwargs):
        with self.assertRaises(b.BackupError):
            self.run_collect(fake, **kwargs)
        self.assertFalse((self.root / b.MANIFEST).exists())
        self.assertFalse((self.root / "storage_objects").exists())
    def test_nested_private_public_manifest(self):
        fake = Fake()
        result = self.run_collect(fake)
        self.assertEqual(result["object_count"], 1)
        self.assertEqual(result["objects"][0]["sha256"], hashlib.sha256(b"abc").hexdigest())
        self.assertEqual(result["objects"][0]["updated_at"], "2026-01-02T00:00:00Z")
        self.assertEqual((self.root / "storage_objects/private-photos/nested/photo.jpg").read_bytes(), b"abc")
        self.assertTrue((self.root / "storage_objects/public-assets").is_dir())
        self.assertTrue(any(c.get("prefix") == "nested" for c in fake.calls))
        text = (self.root / b.MANIFEST).read_text()
        self.assertNotIn("?token=", text)
        self.assertNotIn("\"url\"", text)
        self.assertEqual(b.verify(self.root)["object_count"], 1)
        (self.root / "storage_objects/private-photos/nested/photo.jpg").write_bytes(b"bad")
        with self.assertRaises(b.BackupError): b.verify(self.root)
    def test_pagination_buckets_and_objects(self):
        buckets = [{"id": "bucket-" + str(i), "public": False} for i in range(55)]
        objects = [entry("photo-" + str(i) + ".jpg") for i in range(55)]
        for obj in objects:
            obj["url"] = obj["url"].replace("/private-photos/", "/bucket-0/")
        fake = Fake({("bucket-0", ""): objects}, buckets)
        result = self.run_collect(fake)
        self.assertEqual(result["object_count"], 55)
        self.assertEqual(len(result["buckets"]), 55)
        self.assertTrue(any(c.get("bucket") == "bucket-0" and c["offset"] == 50 for c in fake.calls))
        self.assertTrue(any("bucket" not in c and c["offset"] == 50 for c in fake.calls))
    def test_empty_buckets_complete(self):
        result = self.run_collect(Fake(bucket_rows=[]))
        self.assertEqual(result["object_count"], 0)
        self.assertEqual(result["buckets"], [])
        self.assertTrue(result["complete"])
    def test_shared_size_cap(self):
        self.assert_failed(max_bytes=10)
    def test_manifest_counts_toward_cap(self):
        self.assert_failed(max_bytes=100)
    def test_count_cap_including_folders(self):
        self.assert_failed(max_entries=2)
    def test_deadline(self):
        self.assert_failed(max_seconds=0.000000001)
    def test_declared_size_mismatch(self):
        self.assert_failed(Fake(payload=b"ab"))
    def test_download_failure_cleanup(self):
        fake = Fake()
        def broken(url, target, expected, budget):
            target.write_bytes(b"partial")
            raise OSError("sensitive filename or URL")
        fake.download = broken
        self.assert_failed(fake)
    def test_traversal_entry(self):
        obj = entry("../escape")
        self.assert_failed(Fake({("private-photos", ""): [obj]}))
        self.assertFalse((self.root / "escape").exists())
    def test_duplicate_entry(self):
        obj = entry("photo.jpg")
        self.assert_failed(Fake({("private-photos", ""): [obj, obj]}))
    def test_short_page_with_more_fails_not_truncates(self):
        def mutate(page, params):
            page["hasMore"] = True
            return page
        self.assert_failed(Fake(mutate=mutate))
    def test_unsigned_url_never_downloaded(self):
        obj = entry("photo.jpg")
        obj["url"] = ORIGIN + "/storage/v1/object/public/private-photos/photo.jpg"
        fake = Fake({("private-photos", ""): [obj]})
        self.assert_failed(fake)
        self.assertEqual(fake.downloads, 0)
    def test_origin_change_fails(self):
        def mutate(page, params):
            if "bucket" in params: page["storageOrigin"] = "https://other-project.supabase.co"
            return page
        self.assert_failed(Fake(mutate=mutate))
    def test_symlink_rejected_and_not_followed(self):
        outside = self.root / "outside"
        outside.mkdir()
        link = self.root / "link"
        link.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(b.BackupError): b.directory(link)
        self.run_collect()
        (self.root / "storage_objects/private-photos/evil").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(b.BackupError): b.verify(self.root)
    def test_extra_file_rejected(self):
        self.run_collect()
        (self.root / "storage_objects/private-photos/extra").write_bytes(b"x")
        with self.assertRaises(b.BackupError): b.verify(self.root)
    def test_bad_paths(self):
        for value in ["../x", "/absolute", "a//b", "a/./b", "a/../b", "a\\b", "a\n", "", "a/", "a\x00"]:
            with self.subTest(value=value), self.assertRaises(b.BackupError): b.safe_path(value)
        for value in ["nested/a b.jpg", "literal%2F.jpg", "unicode-\u00e9.jpg"]:
            self.assertEqual(b.safe_path(value), value)
    def test_signed_allowlist(self):
        good = ORIGIN + "/storage/v1/object/sign/private-photos/a.jpg?token=dummy"
        self.assertEqual(b.signed_url(good, ORIGIN, "private-photos", "a.jpg"), good)
        bad = [good.replace("https:", "http:"), good.replace("test-project.supabase.co", "test-project.supabase.co.evil.example"),
               good.replace("test-project.supabase.co", "other-project.supabase.co"), good.replace("/sign/", "/public/"),
               good.replace("a.jpg", "wrong.jpg"), good.replace("?token=dummy", ""), good + "&token=second", good + "&download=1",
               good + "#fragment", good.replace("https://", "https://user:pass@"), good.replace(".co/", ".co:444/")]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(b.BackupError): b.signed_url(value, ORIGIN, "private-photos", "a.jpg")
    def test_endpoint_derivation_no_secret_argument(self):
        self.assertEqual(b.endpoint_from_status("https://app.example/api/cron/backup-status"), ENDPOINT)
        for value in ["http://app.example/api/cron/backup-status", "https://app.example/other", "https://user:pass@app.example/api/cron/backup-status", "https://app.example/api/cron/backup-status?x=1"]:
            with self.assertRaises(b.BackupError): b.endpoint_from_status(value)
    def test_transport_headers_redirects_and_finite_retries(self):
        client = b.Transport(ENDPOINT, "dummy-app-token", time.monotonic() + 10)
        def page_open(req, timeout):
            self.assertEqual(req.get_header("Authorization"), "Bearer dummy-app-token")
            self.assertTrue(req.full_url.startswith(ENDPOINT + "?"))
            response = io.BytesIO(json.dumps({"storageOrigin": ORIGIN, "buckets": [], "hasMore": False}).encode())
            response.status = 200
            return response
        client.opener.open = page_open
        self.assertFalse(client.page(offset=0)["hasMore"])
        def object_open(req, timeout):
            self.assertIsNone(req.get_header("Authorization"))
            response = io.BytesIO(b"abc")
            response.status, response.headers = 200, {"Content-Length": "3"}
            return response
        client.opener.open = object_open
        sha, count = client.download(ORIGIN + "/storage/v1/object/sign/private-photos/x?token=dummy", self.root / "download", 3, 3)
        self.assertEqual(count, 3)
        self.assertEqual(sha, hashlib.sha256(b"abc").hexdigest())
        with self.assertRaises(b.BackupError): b.NoRedirect().redirect_request(Request(ENDPOINT), None, 302, "redirect", {}, "https://evil.example")
        attempts = []
        def error_open(req, timeout):
            attempts.append(1)
            raise URLError("sensitive URL")
        client.opener.open = error_open
        with patch.object(b.time, "sleep"), self.assertRaises(b.BackupError): client.open(ENDPOINT)
        self.assertEqual(len(attempts), 3)
        attempts.clear()
        def unauthorized(req, timeout):
            attempts.append(1)
            raise HTTPError(ENDPOINT, 401, "sensitive response", {}, io.BytesIO(b"secret"))
        client.opener.open = unauthorized
        with patch.object(b.time, "sleep"), self.assertRaises(b.BackupError): client.open(ENDPOINT)
        self.assertEqual(len(attempts), 1)
    def test_download_stream_cap(self):
        client = b.Transport(ENDPOINT, "dummy", time.monotonic() + 10)
        def response(req, timeout):
            data = io.BytesIO(b"toolarge")
            data.status, data.headers = 200, {}
            return data
        client.opener.open = response
        with self.assertRaises(b.BackupError): client.download(ORIGIN + "/storage/v1/object/sign/private-photos/x?token=dummy", self.root / "cap", 3, 3)
    def test_cli_generic_failure_logs_only(self):
        from contextlib import redirect_stderr, redirect_stdout
        err, out = io.StringIO(), io.StringIO()
        with patch.object(b.sys, "argv", ["collector", "--directory", str(self.root)]), patch.dict(os.environ, {"BACKUP_STATUS_URL": "sensitive-invalid-url", "BACKUP_STATUS_TOKEN": "sensitive-token"}), redirect_stderr(err), redirect_stdout(out):
            self.assertEqual(b.main(), 1)
        self.assertNotIn("sensitive", err.getvalue() + out.getvalue())
        self.assertIn("::error::", err.getvalue())

with patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("Network prohibited in offline contract")):
    unittest.main(argv=["offline-storage-contract"], verbosity=1)
`;
const resultPython = spawnSync("python3", ["-B", "-c", python], { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
assert.ifError(resultPython.error);
assert.equal(resultPython.status, 0, resultPython.stderr + resultPython.stdout);
assert.match(resultPython.stderr, /OK/);

// Exercise the workflow's real connection selector, not a duplicated parser.
// Copy/paste whitespace is harmless only outside the complete connection URL.
const selection = workflow.match(/          python3 - <<'PY'\n([\s\S]*?)\n          PY/);
assert.ok(selection);
const selectionPython = selection[1].split("\n").map((line) => line.replace(/^          /, "")).join("\n");
const syntheticPassword = "synthetic:P@ss/#?%";
const pooler = `postgresql://postgres.qjsdglkipgncttztksxl:${encodeURIComponent(syntheticPassword)}@aws-7-ap-south-1.pooler.supabase.com:5432/postgres`;
const temp = await mkdtemp(join(tmpdir(), "storage-backup-url-contract-"));
try {
  for (const [label, url, shouldPass, warning] of [
    ["outer CRLF", ` \r\n${pooler}\r\n\t `, true, true],
    ["unchanged", pooler, true, false],
    ["internal LF", pooler.replace("pooler.supabase", "pooler.\nsupabase"), false, false],
    ["internal CRLF", pooler.replace("pooler.supabase", "pooler.\r\nsupabase"), false, false],
    ["only whitespace", "\r\n \t", false, true],
  ]) {
    const outputFile = join(temp, label.replaceAll(" ", "-"));
    const selected = spawnSync("python3", ["-B", "-c", selectionPython], {
      env: { ...process.env, SUPABASE_DB_URL: "", SUPABASE_POOLER_DB_URL: url, GITHUB_ENV: outputFile },
      encoding: "utf8", timeout: 10000,
    });
    assert.ifError(selected.error);
    assert.equal(selected.status === 0, shouldPass, label);
    assert.equal(selected.stdout.includes("::warning::"), warning, label);
    const safeLogs = selected.stdout.split("\n").filter((line) => !line.startsWith("::add-mask::")).join("\n") + selected.stderr;
    assert.ok(!safeLogs.includes(syntheticPassword) && !safeLogs.includes(encodeURIComponent(syntheticPassword)) && !safeLogs.includes("postgresql://"));
    if (shouldPass) {
      const exported = await readFile(outputFile, "utf8");
      assert.ok(!exported.includes("\r"));
      const selectedUrl = new URL(exported.trim().slice("SUPABASE_DB_URL=".length));
      assert.equal(decodeURIComponent(selectedUrl.password), syntheticPassword);
      assert.equal(selectedUrl.searchParams.get("sslmode"), "require");
      assert.equal(selectedUrl.port, "5432");
    } else {
      await assert.rejects(readFile(outputFile), { code: "ENOENT" });
    }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

assert.equal((workflow.match(/- cron:/g) || []).length, 1, "Preserve one native daily schedule.");
assert.match(workflow, /cron: "40 18 \* \* \*"/);
assert.match(workflow, /contents: read/);
assert.match(workflow, /actions\/checkout@v4/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /MAX_ARCHIVE_BYTES: 104857600/);
assert.match(workflow, /retention-days: 1/);
assert.match(workflow, /timeout-minutes: 12/);
assert.doesNotMatch(workflow, /secrets\.(SUPABASE_SERVICE_ROLE_KEY|STORAGE_|BACKUP_STORAGE)/);
assert.match(workflow, /python3 scripts\/backup_storage_objects\.py --directory backup\n/);
assert.match(workflow, /python3 scripts\/backup_storage_objects\.py --directory backup --verify/);
assert.match(workflow, /tar -czf .* roles\.sql schema\.sql data\.sql storage_objects storage_manifest\.json/);
assert.match(workflow, /trap 'rm -f backup\/roles\.sql[^\n]*rm -rf backup\/storage_objects[^\n]*storage_manifest\.json' EXIT/);
assert.ok(workflow.indexOf("--directory backup --verify") < workflow.indexOf("tar -czf"));
assert.ok(workflow.indexOf("tar -czf") < workflow.indexOf("openssl enc"));
assert.ok(workflow.indexOf('echo "storage_objects=true"') > workflow.indexOf('if [ "$bytes" -gt "$MAX_ARCHIVE_BYTES" ]'));
assert.match(workflow, /job\.status.*success.*&&.*steps\.dump\.outputs\.storage_objects.*true/);
const outcome = workflow.slice(workflow.indexOf("- name: Report backup outcome"));
assert.match(outcome.split("else")[0], /storage_objects\\":true/);
assert.match(outcome.split("else")[1], /storage_objects\\":false/);
assert.match(outcome, /database or photo backup/);
console.log(`Storage backup contract passed: ${cases} mocked endpoint cases, 22 offline Python cases, 5 executable database URL whitespace cases, private/public recursive pagination, signed-URL/token/path guards, shared caps, manifests/hashes, cleanup and honest daily workflow coverage. No live calls.`);
