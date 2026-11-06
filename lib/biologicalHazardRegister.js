// EC-WHS-BIO-002 Rev 1. Shared browser/server contract; no dependencies.
// First aid choices are recorded actions from the source, never medical advice.
export const BIOLOGICAL_DOCUMENT_CODE = "EC-WHS-BIO-002";
export const BIOLOGICAL_DOCUMENT_REVISION = 1;
export const BIOLOGICAL_CATEGORIES = [
  { value: "obs", label: "Observation / hotspot" },
  { value: "pot", label: "Potential exposure" },
  { value: "exp", label: "Exposure incident" },
  { value: "inj", label: "Injury / illness incident" },
  { value: "nm", label: "Near miss / control failure" },
];

const POSITIONS = ["Ecologist", "GIS Lead", "Senior Ecologist", "Administration", "Project Manager", "Managing Director", "Sub-contractor", "Student / volunteer"];
const HOTSPOT_YES = "Yes — vectors repeatedly found in numbers current controls do not manage";

// Section 1 is category; 9 is separate private photo evidence; 12 is declaration.
// Register ID, status and closer are assigned by the backend, not signed fields.
export const BIOLOGICAL_FIELD_SECTIONS = [
  {
    id: "event", title: "2. Event details", fields: [
      { key: "bio_date", label: "Date", type: "date", required: true },
      { key: "bio_time", label: "Time", type: "time" },
      { key: "bio_worker", label: "Worker name", type: "text", required: true },
      { key: "bio_pos", label: "Position", type: "select", options: [...POSITIONS] },
      { key: "bio_rec", label: "Recorded by", type: "text" },
      { key: "bio_proj", label: "Project", type: "text", required: true },
      { key: "bio_loc", label: "Location", type: "text", required: true },
      { key: "bio_coord", label: "Coordinates", type: "text" },
    ],
  },
  {
    id: "hazard", title: "3. Hazard", fields: [
      { key: "bio_haz", label: "Hazard type", type: "select", required: true, options: ["Ticks", "Leeches", "Mosquitoes", "Biting midges / sandflies", "Fleas", "Ants", "Bees / wasps", "Spiders", "Venomous snake", "Animal faeces, urine or carcass", "Contaminated water", "Contaminated soil", "Fungal spores / mould", "Other (describe)"] },
      { key: "bio_ident", label: "Suspected identification", type: "text" },
      { key: "bio_num", label: "Approximate number", type: "number" },
      { key: "bio_cond", label: "Site conditions", type: "chips", options: ["Recent rain", "Wet", "Humid", "Hot", "Long grass", "Dense vegetation", "Leaf litter", "Near watercourse", "Wildlife or livestock use"] },
      { key: "bio_ppe", label: "PPE and controls in place", type: "chips", options: ["Long sleeves", "Long trousers tucked in", "Gaiters", "Enclosed boots", "Gloves", "Repellent", "Treated clothing", "Break inspections"] },
      { key: "bio_rep", label: "Repellent used", type: "text" },
    ],
  },
  {
    id: "observation", title: "4. Observation and hotspot", categories: ["obs"], fields: [
      { key: "bio_hot", label: "Is this a hotspot?", type: "select", options: [HOTSPOT_YES, "No — isolated or occasional", "Unsure — monitor"] },
      { key: "bio_extent", label: "Approximate extent", type: "text" },
      { key: "bio_season", label: "Season pattern", type: "select", options: ["First record", "Seen before this season", "Recurring every year", "Unknown"] },
      { key: "bio_rec_ctrl", label: "Recommended control for this site", type: "textarea" },
    ],
  },
  {
    id: "potential", title: "5. Potential exposure", categories: ["pot"], fields: [
      { key: "bio_dur", label: "Duration in the area", type: "text" },
      { key: "bio_insp", label: "Inspection done after work?", type: "select", options: ["Yes — nothing found", "Yes — vectors on clothing only", "No — not yet done"] },
      { key: "bio_psym", label: "Symptoms since?", type: "select", options: ["None", "Some — describe below"] },
      { key: "bio_why", label: "What made exposure likely", type: "textarea" },
    ],
  },
  {
    id: "exposure", title: "6. Exposure details", categories: ["exp", "inj"], fields: [
      { key: "bio_extype", label: "Exposure type", type: "select", required: true, options: ["Bite", "Attachment", "Sting", "Splash to intact skin", "Splash to broken skin, eyes or mouth", "Ingestion", "Inhalation", "Multiple"] },
      { key: "bio_count", label: "Number of bites / attachments", type: "number" },
      { key: "bio_body", label: "Body location", type: "select", options: ["Head / scalp", "Neck / behind ears", "Arm", "Hand", "Torso", "Waistband", "Groin", "Behind knee", "Leg", "Ankle / foot", "Multiple"] },
      { key: "bio_fa", label: "First aid given", type: "select", options: ["Tick killed in place with freezing spray", "Tick left for medical removal (known allergy)", "Leech removed with salt / salt water", "Wound washed and dressed", "Bite / sting cleaned and monitored", "Eyes or skin flushed", "Adrenaline auto-injector given", "None required"] },
      { key: "bio_fadet", label: "First aid detail", type: "textarea" },
    ],
  },
  {
    id: "injury", title: "7. Injury, illness and medical treatment", categories: ["inj"], fields: [
      { key: "bio_sym", label: "Symptoms", type: "chips", options: ["Itching", "Swelling", "Redness", "Bleeding", "Rash", "Fever", "Fatigue", "Headache", "Nausea", "Difficulty breathing", "Facial swelling", "Muscle weakness"] },
      { key: "bio_med", label: "Medical treatment", type: "select", options: ["Not required", "GP", "Urgent care / hospital", "Ambulance called (000)", "Pending"] },
      { key: "bio_rep_to", label: "Reported to", type: "select", options: ["Field Lead", "WHS Officer", "Project Manager", "Field Lead and WHS Officer"] },
      { key: "bio_ir", label: "Incident Report form lodged?", type: "select", options: ["Yes", "No — not required", "No — to be lodged"] },
      { key: "bio_meddet", label: "Treatment and outcome", type: "textarea" },
    ],
  },
  {
    id: "near-miss", title: "8. Near miss or control failure", categories: ["nm"], fields: [
      { key: "bio_fail", label: "Control that failed", type: "select", required: true, options: ["Communications — no signal or satellite device", "PPE — failed, missing or unsuitable", "Repellent — not available or not applied", "First aid kit — item missing or expired", "Inspection — not completed", "Procedure — not followed", "Other"] },
      { key: "bio_pot", label: "Potential outcome", type: "select", options: ["Minor — first aid", "Moderate — medical treatment", "Serious — hospital", "Life-threatening"] },
      { key: "bio_nmdet", label: "What happened and what could have happened", type: "textarea" },
    ],
  },
  {
    id: "corrective", title: "10. Corrective action", fields: [
      { key: "bio_ca", label: "Corrective action required?", type: "select", options: ["Yes", "No — existing controls adequate"] },
      { key: "bio_owner", label: "Action owner", type: "select", options: [...POSITIONS] },
      { key: "bio_due", label: "Due date", type: "date" },
      { key: "bio_action", label: "Corrective action", type: "textarea" },
    ],
  },
  {
    id: "follow-up", title: "11. Follow-up", categories: ["exp", "inj"], fields: [
      { key: "bio_fu", label: "Follow-up date", type: "date" },
      { key: "bio_fusym", label: "Later symptoms", type: "select", options: ["None", "Yes — describe below"] },
      { key: "bio_fudet", label: "Medical outcome and notes", type: "textarea" },
    ],
  },
];

const FIELDS = BIOLOGICAL_FIELD_SECTIONS.flatMap((section) => section.fields);
const FIELD_KEYS = FIELDS.map((field) => field.key);
const CATEGORY_VALUES = BIOLOGICAL_CATEGORIES.map((category) => category.value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Only plain JSON-like data is accepted. Reject prototype tricks/accessors and
// unknown keys before reading client properties; never merge client objects.
function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor.enumerable && own(descriptor, "value");
  });
}
function onlyKeys(value, keys) { return Reflect.ownKeys(value).every((key) => keys.includes(key)); }
function plainList(value) {
  return Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
      .every((descriptor) => descriptor && descriptor.enumerable && own(descriptor, "value"));
}
function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

// Check an actual PNG envelope, not typed text or a different image MIME type.
// The UI must capture the mark; this cannot attest a signer's identity or ink.
function pngSignature(value) {
  if (value.length > 360_000 || !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  let bytes;
  try { bytes = atob(value.slice("data:image/png;base64,".length)); } catch { return false; }
  const byte = (offset) => bytes.charCodeAt(offset);
  const uint32 = (offset) => byte(offset) * 16777216 + byte(offset + 1) * 65536 + byte(offset + 2) * 256 + byte(offset + 3);
  if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => byte(index) === value)) return false;
  let offset = 8, imageData = false, header = false;
  while (offset + 12 <= bytes.length) {
    const length = uint32(offset), type = bytes.slice(offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) return false;
    if (!header) {
      if (type !== "IHDR" || length !== 13 || !uint32(offset + 8) || !uint32(offset + 12)) return false;
      header = true;
    } else if (type === "IHDR") return false;
    if (type === "IDAT" && length > 0) imageData = true;
    offset += length + 12;
    if (type === "IEND") return length === 0 && imageData && offset === bytes.length;
  }
  return false;
}

export function createEmptyBiologicalHazardForm() {
  return {
    documentCode: BIOLOGICAL_DOCUMENT_CODE,
    documentRevision: BIOLOGICAL_DOCUMENT_REVISION,
    category: "",
    fields: Object.fromEntries(FIELDS.map((field) => [field.key, field.type === "chips" ? [] : ""])),
    declaration: { name: "", date: "", signature: "" },
  };
}

/** Strict server normalization. Draft mode permits unanswered required fields,
 * but not invalid types/choices/lengths. Failure always returns details: null.
 * Hidden category fields are discarded, including stale medical information.
 */
export function normaliseBiologicalHazardDetails(input, { forSubmission = true } = {}) {
  const errors = [];
  if (!plainObject(input)) return { details: null, errors: ["Biological hazard details must be an object."] };
  if (!onlyKeys(input, ["documentCode", "documentRevision", "category", "fields", "declaration"])) errors.push("Details contain unsupported fields.");
  if (input.documentCode !== BIOLOGICAL_DOCUMENT_CODE || input.documentRevision !== BIOLOGICAL_DOCUMENT_REVISION) errors.push(`Only ${BIOLOGICAL_DOCUMENT_CODE} Rev ${BIOLOGICAL_DOCUMENT_REVISION} is supported.`);
  const details = createEmptyBiologicalHazardForm();
  if (!CATEGORY_VALUES.includes(input.category) && !(forSubmission === false && input.category === "")) errors.push("Choose a valid register category.");
  else details.category = input.category;
  const fields = plainObject(input.fields) ? input.fields : null;
  const declaration = plainObject(input.declaration) ? input.declaration : null;
  if (!fields) errors.push("Event fields must be an object.");
  else if (!onlyKeys(fields, FIELD_KEYS)) errors.push("Event fields contain unsupported fields.");
  if (!declaration) errors.push("Declaration must be an object.");
  else if (!onlyKeys(declaration, ["name", "date", "signature"])) errors.push("Declaration contains unsupported fields.");

  function text(value, label, type = "text") {
    if (value === undefined) return "";
    const limit = type === "textarea" ? 4000 : type === "signature" ? 360_000 : 200;
    if (typeof value !== "string" || value.length > limit) { errors.push(`${label} must be text of at most ${limit} characters.`); return ""; }
    const result = value.trim();
    if (result && type === "date" && !calendarDate(result)) errors.push(`${label} must be a valid calendar date (YYYY-MM-DD).`);
    if (result && type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) errors.push(`${label} must be a valid time (HH:mm).`);
    if (result && type === "number" && (!/^\d+$/.test(result) || !Number.isSafeInteger(Number(result)))) errors.push(`${label} must be a nonnegative whole count.`);
    if (result && type === "signature" && !pngSignature(result)) errors.push("Signature must be a captured PNG image (maximum 360000 characters).");
    return result;
  }
  for (const section of BIOLOGICAL_FIELD_SECTIONS) {
    if (section.categories && !section.categories.includes(details.category)) continue;
    for (const field of section.fields) {
      const value = fields ? fields[field.key] : undefined;
      if (field.type === "chips") {
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.length > field.options.length || !plainList(value) ||
          !value.every((item) => typeof item === "string" && field.options.includes(item)) || new Set(value).size !== value.length) {
          errors.push(`${field.label} must contain unique supported choices (maximum ${field.options.length}).`);
        } else details.fields[field.key] = [...value];
      } else {
        details.fields[field.key] = text(value, field.label, field.type);
        if (field.type === "select" && details.fields[field.key] && !field.options.includes(details.fields[field.key])) errors.push(`${field.label} has an unsupported choice.`);
        if (forSubmission && field.required && !details.fields[field.key]) errors.push(`${field.label} is required.`);
      }
    }
  }
  const resultFields = details.fields;
  if (forSubmission) {
    if (resultFields.bio_haz === "Other (describe)" && !resultFields.bio_ident) errors.push("Suspected identification is required for Other (describe).");
    if ((["exp", "inj", "nm"].includes(details.category) || resultFields.bio_hot === HOTSPOT_YES) && !resultFields.bio_ca) errors.push("A corrective action decision is required for exposure, injury, near miss or a hotspot.");
    if (resultFields.bio_ca === "Yes") {
      for (const key of ["bio_action", "bio_owner", "bio_due"]) {
        if (!resultFields[key]) errors.push(`${FIELDS.find((field) => field.key === key).label} is required when corrective action is Yes.`);
      }
    }
  }
  for (const [key, label, type] of [["name", "Declaration name", "text"], ["date", "Declaration date", "date"], ["signature", "Signature", "signature"]]) {
    details.declaration[key] = text(declaration ? declaration[key] : undefined, label, type);
    if (forSubmission && !details.declaration[key]) errors.push(`${label} is required.`);
  }
  return { details: errors.length ? null : details, errors: [...new Set(errors)] };
}

/** Safe aggregate for already-authorized rows. Thresholds indicate recorded
 * patterns, not confirmed medical risk. Never includes worker/identification,
 * symptoms, treatment, signatures, coordinates, notes or photos.
 */
export function buildBiologicalHotspots(rows) {
  if (!Array.isArray(rows)) return [];
  const groups = new Map();
  const display = (value) => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  for (const row of rows) {
    if (!plainObject(row) || !plainObject(row.details) || !plainObject(row.details.fields)) continue;
    const fields = row.details.fields, location = display(fields.bio_loc), project = display(fields.bio_proj);
    const key = JSON.stringify([location.toLowerCase(), project.toLowerCase()]);
    if (!groups.has(key)) groups.set(key, { location, project, hazards: [], entries: 0, exposures: 0, lastRecorded: "", hotspot: false });
    const group = groups.get(key);
    group.entries += 1;
    if (["exp", "inj"].includes(row.details.category)) group.exposures += 1;
    if (BIOLOGICAL_FIELD_SECTIONS[1].fields[0].options.includes(fields.bio_haz) && !group.hazards.includes(fields.bio_haz)) group.hazards.push(fields.bio_haz);
    if (typeof fields.bio_date === "string" && calendarDate(fields.bio_date) && fields.bio_date > group.lastRecorded) group.lastRecorded = fields.bio_date;
    group.hotspot = group.hotspot || fields.bio_hot === HOTSPOT_YES || group.entries >= 3 || group.exposures >= 2;
  }
  return [...groups.values()].sort((a, b) => Number(b.hotspot) - Number(a.hotspot) || b.entries - a.entries || a.location.localeCompare(b.location) || a.project.localeCompare(b.project));
}

/** Full CSV of rows the caller is allowed to read (own submitter/admin WHS).
 * Do not call for notifications or public/general hotspot views. No limiting,
 * revalidation or text truncation: quoting preserves multiline/long values.
 * A leading apostrophe neutralizes spreadsheet formulas without deleting text.
 */
export function exportBiologicalRegisterCsv(rows) {
  const columns = [
    ["ID", (row) => row.id], ["Register ID", (row) => row.register_number],
    ["Created by", (row) => row.created_by], ["Status", (row) => row.status],
    ["Version", (row) => row.version], ["Admin notes", (row) => row.admin_notes],
    ["Administrative follow-up date", (row) => row.follow_up_date],
    ["Administrative follow-up notes", (row) => row.follow_up_notes],
    ["Closed by", (row) => row.closed_by], ["Closed at", (row) => row.closed_at],
    ["Created at", (row) => row.created_at], ["Updated at", (row) => row.updated_at],
    ["Document code", (row) => row.details?.documentCode],
    ["Document revision", (row) => row.details?.documentRevision],
    ["Category", (row) => BIOLOGICAL_CATEGORIES.find((category) => category.value === row.details?.category)?.label ?? row.details?.category],
    ...FIELDS.map((field) => [field.label, (row) => row.details?.fields?.[field.key]]),
    ["Declaration name", (row) => row.details?.declaration?.name],
    ["Declaration date", (row) => row.details?.declaration?.date],
    ["Signature", (row) => row.details?.declaration?.signature],
  ];
  function cell(value) {
    let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    // Include leading whitespace/control characters before a formula indicator,
    // and neutralize tab/CR/LF-starting spreadsheet cells as well.
    if (/^[\s\u0000-\u001f\u007f\ufeff]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  const lines = [columns.map(([label]) => cell(label)).join(",")];
  for (const value of Array.isArray(rows) ? rows : []) {
    const row = value ?? {};
    lines.push(columns.map(([, read]) => cell(read(row))).join(","));
  }
  return lines.join("\r\n");
}
