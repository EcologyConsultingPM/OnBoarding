#!/usr/bin/env python3
"""Collect all Supabase buckets through the private app endpoint, never via a key.

The existing daily workflow owns scheduling and encryption. This collector uses
only Python's standard library; it creates plaintext inside the workflow's
private, trap-cleaned staging directory. No URLs, response bodies or filenames
are logged. Any omission, drift, cap, unsafe path or exhausted retry fails the
whole backup. Storage API pagination is not a point-in-time snapshot: pause
uploads for a consistent restore point where that is required.
"""
import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BYTES = 104857600
MAX_ENTRIES = 10000
PAGE_SIZE = 50
MAX_SECONDS = 240
JSON_BYTES = 1048576
MANIFEST = "storage_manifest.json"


class BackupError(Exception):
    pass


def fail():
    raise BackupError("Storage backup could not be verified.")


def safe_path(value, empty=False):
    if not isinstance(value, str) or len(value) > 1024:
        fail()
    if empty and value == "":
        return value
    if not value or any(ord(c) < 32 or ord(c) == 127 or c == "\\" for c in value):
        fail()
    if any(part in {"", ".", ".."} for part in value.split("/")):
        fail()
    return value


def checked_url(value):
    try:
        if not isinstance(value, str) or any(ord(c) < 33 or ord(c) == 127 for c in value):
            fail()
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.fragment or parts.port not in {None, 443}:
            fail()
        return parts
    except ValueError:
        fail()


def storage_origin(value):
    parts = checked_url(value)
    if not re.fullmatch(r"[a-z0-9-]+\.supabase\.co", parts.hostname) or parts.path not in {"", "/"} or parts.query:
        fail()
    return "https://" + parts.hostname


def signed_url(value, origin, bucket, path):
    parts = checked_url(value)
    query = parse_qs(parts.query)
    if "https://" + parts.hostname != storage_origin(origin) or unquote(parts.path) != f"/storage/v1/object/sign/{bucket}/{path}" or set(query) != {"token"} or len(query["token"]) != 1 or not query["token"][0]:
        fail()
    return value


def endpoint_from_status(value):
    parts = checked_url(value)
    if parts.path != "/api/cron/backup-status" or parts.query:
        fail()
    return urlunsplit((parts.scheme, parts.netloc, "/api/cron/storage-backup", "", ""))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the app bearer token, or follow signed URL redirects.
        fail()


class Transport:
    def __init__(self, endpoint, token, deadline):
        parts = checked_url(endpoint)
        if parts.path != "/api/cron/storage-backup" or parts.query or not token or any(ord(c) < 33 or ord(c) == 127 for c in token):
            fail()
        self.endpoint, self.token, self.deadline = endpoint, token, deadline
        self.opener = build_opener(NoRedirect())

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            fail()
        return min(20, remaining)

    def open(self, url, headers=None):
        for attempt in range(3):
            try:
                response = self.opener.open(Request(url, headers=headers or {}), timeout=self.remaining())
                if response.status != 200:
                    response.close()
                    fail()
                return response
            except HTTPError as error:
                status = error.code
                error.close()
                if status not in {429, 500, 502, 503, 504} or attempt == 2:
                    fail()
            except (URLError, TimeoutError, OSError):
                if attempt == 2:
                    fail()
            time.sleep(min(2 ** attempt, self.remaining()))
        fail()

    def page(self, **params):
        url = self.endpoint + "?" + urlencode({"limit": PAGE_SIZE, **params})
        with self.open(url, {"Authorization": "Bearer " + self.token, "Accept": "application/json"}) as response:
            body = response.read(JSON_BYTES + 1)
        if len(body) > JSON_BYTES:
            fail()
        try:
            page = json.loads(body)
        except (ValueError, UnicodeError):
            fail()
        if not isinstance(page, dict) or type(page.get("hasMore")) is not bool:
            fail()
        return page

    def download(self, url, target, expected, budget):
        # No app bearer header is sent to the signed URL. Mid-stream errors are
        # fatal rather than leaving a partial archive labelled successful.
        digest, count = hashlib.sha256(), 0
        with self.open(url) as response, target.open("xb") as output:
            encoding = response.headers.get("Content-Encoding", "identity")
            length = response.headers.get("Content-Length")
            if encoding != "identity" or length is not None and (not length.isdecimal() or int(length) != expected):
                fail()
            while True:
                self.remaining()
                chunk = response.read(65536)
                if not chunk:
                    break
                count += len(chunk)
                if count > expected or count > budget:
                    fail()
                output.write(chunk)
                digest.update(chunk)
        if count != expected:
            fail()
        return digest.hexdigest(), count


def directory(path):
    # Reject symlinks in every existing ancestor, not only at the final path.
    path = Path(os.path.abspath(path))
    for part in [*reversed(path.parents), path]:
        if not stat.S_ISDIR(part.lstat().st_mode):
            fail()
    return path


def file_target(root, bucket, path):
    safe_path(bucket)
    safe_path(path)
    if "/" in bucket:
        fail()
    target = root / bucket / path
    if not target.is_relative_to(root):
        fail()
    return target


def plain_database_bytes(root):
    total = 0
    for name in ("roles.sql", "schema.sql", "data.sql"):
        item = (root / name).lstat()
        if not stat.S_ISREG(item.st_mode) or item.st_size < 1:
            fail()
        total += item.st_size
    return total


def verify(root, max_bytes=MAX_BYTES):
    root = directory(root)
    manifest_path = root / MANIFEST
    item = manifest_path.lstat()
    if not stat.S_ISREG(item.st_mode) or item.st_size > max_bytes:
        fail()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or manifest.get("complete") is not True or manifest.get("coverage") != "all_buckets" or not isinstance(manifest.get("objects"), list) or not isinstance(manifest.get("buckets"), list):
        fail()
    origin = storage_origin(manifest.get("storage_origin"))
    if not origin or len(manifest["objects"]) > MAX_ENTRIES or len(manifest["buckets"]) > MAX_ENTRIES:
        fail()
    storage = directory(root / "storage_objects")
    buckets = set()
    for bucket in manifest["buckets"]:
        value = safe_path(bucket["id"])
        if "/" in value or value in buckets or type(bucket.get("public")) is not bool:
            fail()
        buckets.add(value)
        directory(storage / value)
    expected, total = set(), 0
    for obj in manifest["objects"]:
        if obj["bucket_id"] not in buckets or type(obj.get("size")) is not int or obj["size"] < 0 or not re.fullmatch(r"[0-9a-f]{64}", obj.get("sha256", "")):
            fail()
        target = file_target(storage, obj["bucket_id"], obj["path"])
        directory(target.parent)
        if target in expected or not stat.S_ISREG(target.lstat().st_mode) or target.stat().st_size != obj["size"]:
            fail()
        expected.add(target)
        digest = hashlib.sha256()
        with target.open("rb") as data:
            for chunk in iter(lambda: data.read(65536), b""):
                digest.update(chunk)
        if digest.hexdigest() != obj["sha256"]:
            fail()
        total += obj["size"]
    actual = set()
    for parent, dirs, files in os.walk(storage, followlinks=False):
        for name in dirs:
            directory(Path(parent) / name)
        for name in files:
            target = Path(parent) / name
            if not stat.S_ISREG(target.lstat().st_mode):
                fail()
            actual.add(target)
    if actual != expected or manifest.get("object_count") != len(expected) or manifest.get("total_object_bytes") != total or total + item.st_size + plain_database_bytes(root) > max_bytes:
        fail()
    return manifest


def collect(root, endpoint, token, max_bytes=MAX_BYTES, transport=None, max_entries=MAX_ENTRIES, max_seconds=MAX_SECONDS):
    if type(max_bytes) is not int or not 1 <= max_bytes <= MAX_BYTES or not 1 <= max_entries <= MAX_ENTRIES or not 0 < max_seconds <= MAX_SECONDS:
        fail()
    root = directory(root)
    base_bytes = plain_database_bytes(root)
    if base_bytes >= max_bytes or (root / MANIFEST).exists() or (root / MANIFEST).is_symlink():
        fail()
    storage = root / "storage_objects"
    storage.mkdir(mode=0o700)  # Existing/partial directories are never reused.
    manifest_created = False
    deadline = time.monotonic() + max_seconds
    try:
        client = transport or Transport(endpoint, token, deadline)
        buckets, objects, visited, entries_seen, total = [], [], set(), 0, 0
        origin = None

        def page_items(page, key):
            nonlocal origin
            if time.monotonic() >= deadline:
                fail()
            current = storage_origin(page.get("storageOrigin"))
            if origin is not None and origin != current:
                fail()
            origin = current
            rows = page.get(key)
            if not isinstance(rows, list) or len(rows) > PAGE_SIZE or type(page.get("hasMore")) is not bool or page["hasMore"] and len(rows) != PAGE_SIZE:
                fail()
            return rows

        offset = 0
        while True:
            page = client.page(offset=offset)
            for bucket in page_items(page, "buckets"):
                value = safe_path(bucket.get("id"))
                if "/" in value or value in visited or type(bucket.get("public")) is not bool:
                    fail()
                visited.add(value)
                entries_seen += 1
                if entries_seen > max_entries:
                    fail()
                buckets.append({"id": value, "public": bucket["public"]})
                (storage / value).mkdir(mode=0o700)
            if not page["hasMore"]:
                break
            offset += PAGE_SIZE
            if offset > MAX_ENTRIES:
                fail()

        queue = deque((bucket["id"], "") for bucket in buckets)
        seen_paths = set()
        while queue:
            bucket, prefix = queue.popleft()
            offset = 0
            while True:
                page = client.page(bucket=bucket, prefix=prefix, offset=offset)
                for entry in page_items(page, "entries"):
                    name = safe_path(entry.get("name"))
                    path = safe_path(entry.get("path"))
                    if "/" in name or path != (prefix + "/" if prefix else "") + name or (bucket, path) in seen_paths or type(entry.get("isFolder")) is not bool:
                        fail()
                    seen_paths.add((bucket, path))
                    entries_seen += 1
                    if entries_seen > max_entries:
                        fail()
                    if entry["isFolder"]:
                        if entry.get("url") is not None:
                            fail()
                        queue.append((bucket, path))
                        continue
                    size = entry.get("size")
                    if type(size) is not int or size < 0 or base_bytes + total + size > max_bytes:
                        fail()
                    url = signed_url(entry.get("url"), origin, bucket, path)
                    target = file_target(storage, bucket, path)
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    directory(target.parent)
                    digest, count = client.download(url, target, size, max_bytes - base_bytes - total)
                    if count != size or not re.fullmatch(r"[0-9a-f]{64}", digest):
                        fail()
                    total += count
                    objects.append({"bucket_id": bucket, "path": path, "id": entry.get("id"), "size": count,
                                    "mimeType": entry.get("mimeType"), "updated_at": entry.get("updated_at"), "sha256": digest})
                if not page["hasMore"]:
                    break
                offset += PAGE_SIZE
                if offset > MAX_ENTRIES:
                    fail()
        manifest = {"version": 1, "complete": True, "coverage": "all_buckets", "storage_origin": origin,
                    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "buckets": buckets, "objects": objects, "object_count": len(objects), "total_object_bytes": total}
        encoded = (json.dumps(manifest, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
        if len(encoded) + base_bytes + total > max_bytes or time.monotonic() >= deadline:
            fail()
        with (root / MANIFEST).open("xb") as output:
            manifest_created = True
            output.write(encoded)
        verify(root, max_bytes)
        if time.monotonic() >= deadline:
            fail()
        return manifest
    except Exception:
        shutil.rmtree(storage)
        if manifest_created:
            (root / MANIFEST).unlink(missing_ok=True)
        raise BackupError("Storage backup could not be verified.") from None


def main():
    parser = argparse.ArgumentParser(description="Collect or verify private storage backup (no credentials in arguments).")
    parser.add_argument("--directory", default="backup")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        maximum = int(os.environ.get("MAX_ARCHIVE_BYTES", str(MAX_BYTES)))
        if not 1 <= maximum <= MAX_BYTES:
            fail()
        if args.verify:
            verify(args.directory, maximum)
        else:
            collect(args.directory, endpoint_from_status(os.environ.get("BACKUP_STATUS_URL", "")),
                    os.environ.get("BACKUP_STATUS_TOKEN", ""), maximum)
        print("Storage backup manifest and object hashes verified.")
        return 0
    except Exception:
        print("::error::Storage backup failed or exceeded the shared size/count/time ceiling; no complete archive is verified.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
