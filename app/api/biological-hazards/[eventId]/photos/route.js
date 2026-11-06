import { randomUUID } from "node:crypto";
import nativeSharp from "sharp";
import { requireSession } from "../../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "biological-hazard-photos";
const MAX_BYTES = 8 * 1024 * 1024;
const nodeRequire = () => nativeSharp;
const reply = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });
function failure(error) {
  const marker = String(error?.message || "").split(":")[0];
  const known = { BIO_FORBIDDEN: [403, "You do not have access to this record."], BIO_NOT_FOUND: [404, "Record not found."], BIO_PHOTO_LIMIT: [409, "This record already has five photos."], BIO_INVALID_INPUT: [400, "The photo could not be attached." ] };
  const [status, message] = known[marker] || (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code) ? [503, "The biological register is not yet available."] : [500, "The photo request could not be completed. Retry using the existing record."]);
  return reply({ error: message }, status);
}
async function authorize(request, eventId) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  const scope = new URL(request.url).searchParams.get("scope") || (access.isAdmin ? "admin" : "mine");
  if (!['mine', 'admin'].includes(scope)) return { error: reply({ error: "Use scope=mine or scope=admin." }, 400) };
  const denied = await requirePortalResource(access, scope === "admin" ? "admin.whs_monitoring" : "staff.forms");
  if (denied) return { error: denied };
  if (scope === 'admin') {
    if (!access.isAdmin) return { error: reply({ error: "Administrator access is required." }, 403) };
    const { data, error } = await access.admin.rpc("biological_hazard_can_manage", { p_actor_id: access.user.id });
    if (error) return { error: failure(error) };
    if (data !== true) return { error: reply({ error: "Administrator access is required." }, 403) };
  }
  if (!UUID.test(eventId || '')) return { error: reply({ error: "Record not found." }, 404) };
  let query = access.admin.from("biological_hazard_events").select("id,created_by").eq("id", eventId);
  if (scope === "mine") query = query.eq("created_by", access.user.id);
  const { data: event, error } = await query.maybeSingle();
  if (error) return { error: failure(error) };
  if (!event) return { error: reply({ error: "Record not found." }, 404) };
  return { access, event };
}
function magicType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function pathLinked(path, eventId) {
  return typeof path === 'string' && new RegExp(`^events/${eventId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpeg$`, 'i').test(path);
}
export async function GET(request, context) {
  try {
    const { eventId } = await context.params;
    const auth = await authorize(request, eventId);
    if (auth.error) return auth.error;
    const photoId = new URL(request.url).searchParams.get('photoId');
    if (!UUID.test(photoId || '')) return reply({ error: "A valid photoId is required." }, 400);
    const { data: photo, error } = await auth.access.admin.from("biological_hazard_photos").select("id,event_id,storage_path").eq("event_id", eventId).eq("id", photoId).maybeSingle();
    if (error) return failure(error);
    if (!photo || !pathLinked(photo.storage_path, auth.event.id)) return reply({ error: "Photo not found." }, 404);
    const result = await auth.access.admin.storage.from(BUCKET).createSignedUrl(photo.storage_path, 300);
    if (result.error || !result.data?.signedUrl) return failure();
    return reply({ photoId, signedUrl: result.data.signedUrl, expiresIn: 300 });
  } catch { return failure(); }
}
export async function POST(request, context) {
  let uploadedPath = null;
  let storage = null;
  try {
    const { eventId } = await context.params;
    const auth = await authorize(request, eventId);
    if (auth.error) return auth.error;
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) return reply({ error: "Upload one image using multipart file." }, 400);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BYTES + 65536) return reply({ error: "Each photo must be at most 8 MB." }, 413);
    // Bound the multipart body before parsing; never trust just Content-Length.
    if (!request.body) return reply({ error: "Invalid image upload." }, 400);
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES + 65536) {
          await reader.cancel().catch(() => null);
          return reply({ error: "Each photo must be at most 8 MB." }, 413);
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const body = Buffer.concat(chunks, total);
    let form;
    try { form = await new Request('https://local.invalid/upload', { method: 'POST', headers: { 'content-type': request.headers.get('content-type') }, body }).formData(); }
    catch { return reply({ error: "Invalid image upload." }, 400); }
    if ([...form.keys()].some(k => k !== 'file') || form.getAll('file').length !== 1) return reply({ error: "Upload exactly one file." }, 400);
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function' || file.size < 1 || file.size > MAX_BYTES) return reply({ error: "Each photo must be between 1 byte and 8 MB." }, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = magicType(bytes);
    if (!type || type !== file.type || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return reply({ error: "Use a valid JPEG, PNG or WebP photo." }, 400);
    // This is a non-personal identifier generated by the staff form, not the
    // original camera filename. Retain it so uncertain uploads can reconcile.
    const fileName = /^biological-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i.test(file.name || '') ? file.name.toLowerCase() : 'photo.jpeg';
    if (fileName !== 'photo.jpeg') {
      const existing = await auth.access.admin.from("biological_hazard_photos")
        .select("id,event_id,file_name,mime_type,size_bytes,created_by,created_at")
        .eq("event_id", eventId).eq("file_name", fileName).maybeSingle();
      if (existing.error) return failure(existing.error);
      if (existing.data) return reply({ photo: existing.data, duplicate: true }, 201);
    }
    let sharp;
    try { sharp = nodeRequire('sharp'); }
    catch { return reply({ error: "Secure photo processing is temporarily unavailable. The report is saved; retry photos later." }, 503); }
    let image;
    try {
      const pipeline = sharp(bytes, { failOn: 'warning', limitInputPixels: 40000000, animated: false });
      const metadata = await pipeline.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error('Invalid image');
      // Full decoding plus fresh JPEG strips EXIF/GPS, names and embedded payloads.
      image = await pipeline.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
      if (image.length > MAX_BYTES) throw new Error('Image too large');
    } catch { return reply({ error: "The image could not be decoded. Choose another photo." }, 400); }
    storage = auth.access.admin.storage.from(BUCKET);
    const photoId = randomUUID();
    const path = `events/${auth.event.id}/${photoId}.jpeg`;
    const upload = await storage.upload(path, image, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' });
    if (upload.error) return failure();
    uploadedPath = path;
    let attach;
    try {
      attach = await auth.access.admin.rpc("biological_hazard_attach_photo", { p_actor_id: auth.access.user.id, p_event_id: eventId, p_photo: { id: photoId, storage_path: path, file_name: fileName, mime_type: 'image/jpeg', size_bytes: image.length } });
    } catch {
      // A lost response does not prove rollback. Check linkage before cleanup so
      // a committed attachment never loses its object just because of a timeout.
      const verified = await Promise.resolve(auth.access.admin.from("biological_hazard_photos")
        .select("id,event_id,file_name,mime_type,size_bytes,created_by,created_at")
        .eq("event_id", auth.event.id).eq("id", photoId).maybeSingle())
        .catch(() => ({ error: true }));
      uploadedPath = null;
      if (verified.data && !verified.error) {
        const { storage_path, ...photo } = verified.data;
        return reply({ photo }, 201);
      }
      if (verified.error) {
        console.warn('Biological photo attachment reconciliation requires server maintenance.');
        return failure();
      }
      await storage.remove([path]).catch(() => null);
      return failure();
    }
    if (attach.error) {
      const cleanup = await storage.remove([path]).catch(() => ({ error: true }));
      uploadedPath = null;
      // No object key or raw Storage diagnostic is exposed in logs or the response.
      if (cleanup?.error) console.warn('Biological photo cleanup requires server maintenance.');
      return failure(attach.error);
    }
    // Concurrent retries may both upload, but the locked RPC attaches only one.
    if (attach.data?.id !== photoId) {
      const cleanup = await storage.remove([path]).catch(() => ({ error: true }));
      if (cleanup?.error) console.warn('Biological photo duplicate cleanup requires server maintenance.');
    }
    uploadedPath = null;
    const { storage_path, ...photo } = attach.data;
    return reply({ photo }, 201);
  } catch {
    if (uploadedPath && storage) await storage.remove([uploadedPath]).catch(() => null);
    return failure();
  }
}
