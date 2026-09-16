import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_SIGNATURE_LENGTH = 360000;
const MAX_ACTIONS = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_YEAR = /^(0[1-9]|1[0-2])\/\d{4}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const OUTCOMES = new Set([
  "Pass — no action",
  "Restocked on the spot",
  "Items ordered — kit still serviceable",
  "Failed — kit removed from service",
]);
const CHECK_TYPES = new Set([
  "Scheduled monthly check",
  "Post-use restock",
  "Pre-mobilisation spot check",
  "Annual audit",
]);
const ISSUES = new Set(["expired", "missing", "used", "damaged", "other"]);
const ACTIONS = new Set(["restocked_on_spot", "restock_ordered", "removed_from_service"]);

// The client renders the same controlled inventory. Server validation uses refs
// and canonical descriptions so an altered browser payload cannot omit an item
// or change a controlled record after the physical check.
const inventory = {
  A: [
    "AEROPLAST Plastic Fabric Plasters 72mm × 19mm", "AEROPLAST Plastic Plasters 72mm × 19mm", "AEROAID Antiseptic Spray 50ml", "AEROWIPE Cleansing Wipe", "AEROSWAB Gauze Swabs 7.5cm × 7.5cm, 3s", "AEROPAD™ Low Adherent Dressings 5cm × 5cm", "AEROPAD™ Low Adherent Dressings 10cm × 10cm", "AEROFORM Conforming Bandage 7.5cm × 4M", "AEROPORE Microporous Tape 2.5cm × 5M", "AEROGLOVE Nitrile Examination Gloves", "AEROINSTRUMENTS Scissor 10cm", "AEROINSTRUMENTS Tweezer 12cm", "AEROPROBE Splinter Probes 3.7cm", "AEROPINS Safety Pins", "AEROSUPPLIES Notebook & Pen", "First Aid Leaflet",
    "AEROFORM™ Heavyweight Conforming Bandage 10cm × 4m", "AEROBAND™ Triangular Bandage 110 × 110 × 155cm", "AEROPAD™ Low Adherent Dressings 5cm × 5cm", "AEROWOUND™ BPC Wound Dressing #15", "AEROWOUND™ Combine Dressing 10cm × 20cm", "AEROSWAB™ Gauze Swabs 7.5 × 7.5cm, 3s", "AERORESCUE™ Emergency Rescue Blanket (silver)", "AEROPLAST™ Instant Ice Pack 80g", "AEROPLAST™ Amputated Parts Bag", "AEROSHIELD™ CPR Face Shield", "AEROGLOVE™ Nitrile Examination Gloves",
    "AEROBURN™ Burn Gel Sachets 3.5g", "AEROBURN™ Burn Dressing 10cm × 10cm", "AEROBURN™ PE Burn Sheet 10cm × 10cm", "AEROBURN™ PE Burn Sheet 20cm × 20cm", "AEROBURN™ PE Burn Sheet 60cm × 90cm", "AEROFORM™ Conforming Bandage 7.5cm × 4m", "AEROGLOVE™ Nitrile Examination Gloves", "AEROGUIDE Burns First Aid Card",
    "AEROWASH™ Eye Wash Ampoule", "AEROPAD™ Eye Pads", "AEROFORM™ Conforming Bandage", "AEROPORE™ Microporous Tape", "AEROGLOVE™ Nitrile Examination Gloves", "Eye Wound Treatment Card", "AEROFORM Indicator Bandage", "AEROBAND™ Triangular Bandage 110 × 110 × 155cm", "AEROPAD™ Low Adherent Dressings 5cm × 5cm", "AEROPAD™ Low Adherent Dressings 7.5cm × 10cm", "AEROGLOVE™ Nitrile Examination Gloves", "Snake Bite Treatment Leaflet", "AEROFORM™ Conforming Bandage", "AEROFORM™ Conforming Bandage", "AEROPAD™ Low Adherent Dressings", "AEROPAD™ Low Adherent Dressings", "AEROPAD™ Low Adherent Dressings", "AEROSWAB™ Gauze Swabs 7.5 × 7.5cm", "AEROWOUND™ BPC Wound Dressing",
  ],
  B: ["Adhesive Plasters, plastic, 72 × 19mm", "Wound Wipe, alcohol swab", "Wound Wipe, povidone iodine swab", "Wound Wipe, non-sting wipe", "Gauze Swabs, 7.5 × 7.5cm, 5pk", "Non-Adherent Dressing, 5 × 5cm", "Wound Dressing, No.13", "Conforming Bandage, 7.5cm", "Triangular Bandage, disposable", "Paper Tape, hypoallergenic, 1.25cm", "Assorted Safety Pins", "Eye Pads, non-adherent", "Eye Wash, 15ml ampoule", "Hydrogel Burn Gel, 3.5g sachet", "Cotton Tip Applicators", "Disposable Splinter Probes", "Tweezers, 9cm steel", "Scissors, 9cm steel", "Nitrile Disposable Gloves, large", "Resuscitation Face Shield, disposable, with valve", "Plastic Bag, resealable, medium", "Plastic Bag, resealable, small", "Emergency First Aid Information Booklet"],
  C: ["Heavy Crepe Bandage, 10cm", "Triangular Bandage, cotton", "Instant Cold Pack, small", "Emergency First Aid Information Booklet", "Snake and Spider Bite Guide"],
};
const canonical = Object.fromEntries(Object.entries(inventory).map(([kit, items]) => [kit, items.map((name, index) => ({ ref: `${kit}${index + 1}`, name }))]));
const SELECT_COLUMNS = "id, checked_by, check_date, next_check_due, check_type, checked_by_name, checked_by_position, selected_kits, restock_register, usage_notes, created_at";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasOnlyKeys(value, keys) {
  return isObject(value) && Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function hasValidDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function validationFailure(message) {
  return { error: message };
}

function validatePayload(body) {
  const allowed = ["check_date", "next_check_due", "check_type", "checked_by_name", "checked_by_position", "selected_kits", "restock_register", "usage_notes", "signature"];
  if (!hasOnlyKeys(body, allowed)) return validationFailure("The submission has an invalid field.");
  if (!hasValidDate(body.check_date)) return validationFailure("A valid check date is required.");
  if (!hasValidDate(body.next_check_due) || body.next_check_due <= body.check_date) return validationFailure("Next check due must be a valid date after the check date.");
  if (!CHECK_TYPES.has(body.check_type)) return validationFailure("Choose a valid check type.");
  const checkedByName = text(body.checked_by_name, 100);
  const checkedByPosition = text(body.checked_by_position, 100);
  if (checkedByName.length < 2 || checkedByPosition.length < 2) return validationFailure("Checker name and position are required.");
  if (typeof body.signature !== "string" || !body.signature.startsWith("data:image/png;base64,") || body.signature.length < 100 || body.signature.length > MAX_SIGNATURE_LENGTH) return validationFailure("A valid PNG finger signature is required.");
  if (!Array.isArray(body.selected_kits) || body.selected_kits.length < 1 || body.selected_kits.length > 3) return validationFailure("Select between one and three kits.");
  if (!Array.isArray(body.restock_register) || body.restock_register.length > MAX_ACTIONS) return validationFailure("Too many restock or removal actions.");
  if (typeof body.usage_notes !== "string" || body.usage_notes.length > 2000) return validationFailure("Usage notes exceed the permitted length.");

  const seenKits = new Set();
  const selectedKits = [];
  const failures = new Set();
  for (const kit of body.selected_kits) {
    if (!hasOnlyKeys(kit, ["kit", "kit_number", "outcome", "items"]) || !Object.prototype.hasOwnProperty.call(canonical, kit.kit) || seenKits.has(kit.kit)) return validationFailure("Selected kits must be unique controlled kits.");
    seenKits.add(kit.kit);
    const kitNumber = text(kit.kit_number, 80);
    if (kitNumber.length < 2 || !OUTCOMES.has(kit.outcome) || !Array.isArray(kit.items) || kit.items.length !== canonical[kit.kit].length) return validationFailure(`Kit ${kit.kit} is incomplete.`);
    const items = [];
    for (let index = 0; index < kit.items.length; index += 1) {
      const item = kit.items[index];
      const expected = canonical[kit.kit][index];
      if (!hasOnlyKeys(item, ["ref", "qty_in_kit", "batch_no", "expiry_date", "ok"]) || item.ref !== expected.ref || typeof item.ok !== "boolean") return validationFailure(`Kit ${kit.kit} inventory does not match the controlled register.`);
      const quantity = text(item.qty_in_kit, 30);
      const batch = text(item.batch_no, 80);
      const expiry = text(item.expiry_date, 7);
      if (!quantity || (item.expiry_date && expiry !== item.expiry_date.trim()) || (expiry && !MONTH_YEAR.test(expiry))) return validationFailure(`Complete quantity and valid expiry (MM/YYYY) for ${expected.ref}.`);
      if (!item.ok) failures.add(`${kit.kit}:${expected.ref}`);
      items.push({ ref: expected.ref, qty_in_kit: quantity, batch_no: batch, expiry_date: expiry, ok: item.ok });
    }
    selectedKits.push({ kit: kit.kit, kit_number: kitNumber, outcome: kit.outcome, items });
  }

  const actions = [];
  const actionKeys = new Set();
  for (const row of body.restock_register) {
    if (!hasOnlyKeys(row, ["kit", "item_ref", "item", "issue", "action", "qty_needed", "action_owner", "date_required"]) || !seenKits.has(row.kit)) return validationFailure("An action references a kit that was not selected.");
    const validRef = row.item_ref === "KIT" || canonical[row.kit].some((item) => item.ref === row.item_ref);
    const item = text(row.item, 160);
    const quantity = text(row.qty_needed, 30);
    const owner = text(row.action_owner, 100);
    if (!validRef || item.length < 2 || !ISSUES.has(row.issue) || !ACTIONS.has(row.action) || !quantity || owner.length < 2 || !hasValidDate(row.date_required)) return validationFailure("Every restock or removal action must be complete and valid.");
    const key = `${row.kit}:${row.item_ref}`;
    if (actionKeys.has(key)) return validationFailure("Only one action may be recorded for each kit item.");
    actionKeys.add(key);
    actions.push({ kit: row.kit, item_ref: row.item_ref, item, issue: row.issue, action: row.action, qty_needed: quantity, action_owner: owner, date_required: row.date_required });
  }
  for (const failed of failures) {
    const [kit, ref] = failed.split(":");
    if (!actions.some((row) => row.kit === kit && row.item_ref === ref)) return validationFailure(`${ref} is not OK and needs a restock or removal action.`);
  }
  for (const kit of selectedKits) {
    if (kit.outcome === "Failed — kit removed from service" && !actions.some((row) => row.kit === kit.kit && row.item_ref === "KIT" && row.action === "removed_from_service")) return validationFailure(`Kit ${kit.kit} failed and needs a kit-level removal-from-service action.`);
    if (kit.outcome === "Items ordered — kit still serviceable" && !actions.some((row) => row.kit === kit.kit && row.action === "restock_ordered")) return validationFailure(`Kit ${kit.kit} has items ordered and needs a restock-order action.`);
  }
  return { value: { check_date: body.check_date, next_check_due: body.next_check_due, check_type: body.check_type, checked_by_name: checkedByName, checked_by_position: checkedByPosition, selected_kits: selectedKits, restock_register: actions, usage_notes: text(body.usage_notes, 2000) || null, signature: body.signature } };
}

async function notifyWHS(admin, check) {
  const needsAttention = check.restock_register.length > 0 || check.selected_kits.some((kit) => kit.outcome === "Failed — kit removed from service");
  if (!needsAttention) return;
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    const recipients = (data?.users || []).filter((user) => /@ecologyconsulting\.au$/i.test(user.email || "") && (user.user_metadata?.whs_officer === true || user.user_metadata?.is_primary_admin === true));
    if (!recipients.length) return;
    const failed = check.selected_kits.some((kit) => kit.outcome === "Failed — kit removed from service");
    const { error: eventError } = await admin.from("portal_events").insert(recipients.map((recipient) => ({
      recipient_id: recipient.id,
      event_type: "first_aid_kit_issue",
      severity: failed ? "action_required" : "information",
      title: failed ? "First aid kit removed from service" : "First aid kit action required",
      body: `First aid kit check submitted ${check.check_date} by ${check.checked_by_name}.`,
      // Root portal href: Staff Forms / old deep links are not application routes.
      href: "/?portal=admin&area=whsmonitor",
      source_table: "first_aid_kit_checks",
      source_id: check.id,
    })));
    if (eventError) throw eventError;
  } catch (error) {
    // The compliance record is durable before notification and must not be lost
    // just because the event feed or user directory is temporarily unavailable.
    console.warn("First aid kit notification failed:", error?.message || error);
  }
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, access.isAdmin ? "admin.whs" : "staff.forms");
    if (denied) return denied;
    let query = access.admin.from("first_aid_kit_checks").select(SELECT_COLUMNS).order("created_at", { ascending: false }).limit(100);
    if (!access.isAdmin) query = query.eq("checked_by", access.user.id);
    const { data, error } = await query;
    if (error) return jsonError("Unable to load first aid kit checks.", 500);
    return Response.json({ checks: data || [], isAdmin: access.isAdmin });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, access.isAdmin ? "admin.whs" : "staff.forms");
    if (denied) return denied;
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BYTES) return jsonError("The submitted record is too large.", 413);
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return jsonError("The submitted record is too large.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { return jsonError("The submission must be valid JSON."); }
    const idempotencyKey = request.headers.get("idempotency-key") || "";
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) return jsonError("A valid idempotency key is required.");
    const validation = validatePayload(body);
    if (validation.error) return jsonError(validation.error);

    const { data: existing, error: existingError } = await access.admin.from("first_aid_kit_checks").select(SELECT_COLUMNS).eq("checked_by", access.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingError) return jsonError("Unable to check submission status.", 500);
    if (existing) return Response.json({ check: existing, idempotent: true });

    const row = { ...validation.value, checked_by: access.user.id, idempotency_key: idempotencyKey };
    let inserted = await access.admin.from("first_aid_kit_checks").insert(row).select(SELECT_COLUMNS).single();
    if (inserted.error?.code === "23505") {
      inserted = await access.admin.from("first_aid_kit_checks").select(SELECT_COLUMNS).eq("checked_by", access.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (inserted.data) return Response.json({ check: inserted.data, idempotent: true });
    }
    if (inserted.error) return jsonError("Unable to save the first aid kit check.", 500);
    await notifyWHS(access.admin, { ...inserted.data, selected_kits: row.selected_kits, restock_register: row.restock_register });
    return Response.json({ check: inserted.data, idempotent: false }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
