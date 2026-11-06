import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OFFSET = 10000;
const MAX_LIMIT = 50;
const SIGNED_URL_SECONDS = 300;

function reply(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization", "X-Content-Type-Options": "nosniff" },
  });
}

function authorised(request) {
  const expected = process.env.BACKUP_STATUS_TOKEN || "";
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function safePath(value, allowEmpty = false) {
  return typeof value === "string" && (allowEmpty && value === "" ||
    value.length > 0 && value.length <= 1024 && !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".."));
}

function safeBucket(value) {
  return safePath(value) && /^[A-Za-z0-9._-]{1,100}$/.test(value);
}

function integer(value, fallback, max) {
  if (value === null) return fallback;
  if (!/^\d{1,5}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= max ? number : null;
}

// Storage's own API works even when the storage schema is not exposed by
// PostgREST. Each caller page is one folder, not a silently truncated flat list.
// No user JWT, anonymous client, public URL or database RPC is accepted here.
export async function GET(request) {
  if (!authorised(request)) return reply({ error: "Unauthorised backup collector." }, 401);
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["bucket", "prefix", "offset", "limit"].includes(key) || params.getAll(key).length !== 1)) {
    return reply({ error: "Invalid storage backup parameters." }, 400);
  }
  const bucket = params.get("bucket");
  const prefix = params.get("prefix") || "";
  const offset = integer(params.get("offset"), 0, MAX_OFFSET);
  const limit = integer(params.get("limit"), MAX_LIMIT, MAX_LIMIT);
  if (offset === null || limit === null || limit < 1 || !safePath(prefix, true) ||
      (bucket !== null && !safeBucket(bucket)) || (bucket === null && prefix)) {
    return reply({ error: "Invalid storage backup parameters." }, 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) ||
        parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || !key) throw new Error();
    origin = parsed.origin;
  } catch {
    return reply({ error: "Storage backup server configuration is incomplete." }, 503);
  }

  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if (bucket === null) {
      // https://supabase.com/docs/reference/javascript/file-buckets-listbuckets
      // Pinned SDK 2.111.0 supports sortColumn=id, offset and limit:
      // https://github.com/supabase/supabase-js/blob/v2.111.0/packages/core/storage-js/src/packages/StorageBucketApi.ts
      const { data: buckets, error: bucketError } = await admin.storage.listBuckets({ limit, offset, sortColumn: "id", sortOrder: "asc" });
      if (bucketError || !Array.isArray(buckets) || buckets.length > limit) throw new Error();
      if (buckets.some((item) => !safeBucket(item.id))) throw new Error();
      return reply({ storageOrigin: origin, buckets: buckets.map((item) => ({
        id: item.id, name: item.name, public: item.public === true,
      })), entries: [], hasMore: buckets.length === limit });
    }
    const { data: found, error: lookupError } = await admin.storage.getBucket(bucket);
    if (lookupError) {
      if (String(lookupError.status ?? lookupError.statusCode) === "404") return reply({ error: "Storage bucket not found." }, 404);
      throw new Error();
    }
    if (!found || found.id !== bucket) throw new Error();
    const storage = admin.storage.from(bucket);
    const { data, error } = await storage.list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
    if (error || !Array.isArray(data) || data.length > limit) throw new Error();
    const entries = data.map((item) => {
      if (!safePath(item.name) || item.name.includes("/")) throw new Error();
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!safePath(path)) throw new Error();
      const isFolder = item.id === null && item.metadata === null;
      const size = isFolder ? null : Number(item.metadata?.size);
      if (!isFolder && (typeof item.id !== "string" || !item.id || item.metadata?.size == null || !Number.isSafeInteger(size) || size < 0)) throw new Error();
      return { name: item.name, path, isFolder, id: isFolder ? null : item.id, size,
        mimeType: isFolder ? null : (typeof item.metadata?.mimetype === "string" ? item.metadata.mimetype : null),
        updated_at: isFolder ? null : (typeof item.updated_at === "string" ? item.updated_at : null) };
    });
    const objects = entries.filter((entry) => !entry.isFolder);
    if (objects.length) {
      const { data: signed, error: signingError } = await storage.createSignedUrls(objects.map((entry) => entry.path), SIGNED_URL_SECONDS);
      if (signingError || !Array.isArray(signed) || signed.length !== objects.length) throw new Error();
      const signedByPath = new Map(signed.map((item) => [item.path, item]));
      for (const entry of objects) {
        const item = signedByPath.get(entry.path);
        if (!item || item.error || !item.signedUrl) throw new Error();
        const signedUrl = new URL(item.signedUrl, origin);
        if (signedUrl.origin !== origin || signedUrl.username || signedUrl.password || signedUrl.hash ||
            decodeURIComponent(signedUrl.pathname) !== `/storage/v1/object/sign/${bucket}/${entry.path}` || !signedUrl.searchParams.get("token")) throw new Error();
        entry.url = signedUrl.href;
      }
    }
    return reply({ storageOrigin: origin, entries, hasMore: data.length === limit });
  } catch {
    // Provider errors may contain medical filenames, tokens or service details.
    return reply({ error: "Storage backup listing or signing failed." }, 502);
  }
}
