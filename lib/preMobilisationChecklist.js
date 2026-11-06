// EC-OPS-PMC-001 Rev 4 — controlled pre-mobilisation checklist contract.
// This module deliberately has no browser dependencies so it can also enforce the
// same contract in the server-side WHS submission route.

export const PRE_MOBILISATION_FORM_TYPE = "pre_mobilisation";
export const PRE_MOBILISATION_DOCUMENT_CODE = "EC-OPS-PMC-001";
export const PRE_MOBILISATION_DOCUMENT_REVISION = 4;
export const PRE_MOBILISATION_DOCUMENT_LABEL = `${PRE_MOBILISATION_DOCUMENT_CODE} Rev ${PRE_MOBILISATION_DOCUMENT_REVISION}`;
export const CHECK_OUTCOMES = ["pass", "fail", "na"];
export const BIOLOGICAL_CHECK_OUTCOMES = ["yes", "no", "na"];

export const VEHICLE_TYPES = [
  "2WD ute / van",
  "4WD wagon",
  "4WD ute — dual cab",
  "Hire vehicle",
  "Private vehicle (approved)",
];

// Controlled choices keep the pre-departure record concise, comparable and
// practical to complete on a field tablet.
export const WEATHER_CONDITIONS = [
  "Sunny / Clear",
  "Partly Cloudy",
  "Cloudy",
  "Overcast",
  "Rain",
  "Drizzle",
  "Snow",
  "Stormy",
];

export const FIRE_DANGER_RATINGS = [
  "No rating",
  "Moderate",
  "High",
  "Extreme",
  "Catastrophic",
];

export const MOBILE_COVERAGE_OPTIONS = [
  "Full",
  "Patchy",
  "None — satellite / In-Reach required",
];

export const PRE_MOBILISATION_SECTIONS = [
  {
    id: "vehicle",
    title: "Vehicle condition",
    mandatory: true,
    rows: [
      ["V1", "Sufficient fuel for the entire journey."],
      ["V2", "All fluid levels are full — coolant, engine oil, power steering, transmission and windscreen washer."],
      ["V3", "Battery terminals are clean and leads are securely connected."],
      ["V4", "Windscreen wiper blades are in good working condition."],
      ["V5", "Windows and mirrors are clean, undamaged and provide clear visibility."],
      ["V6", "Tyres, including the spare, are in good condition and properly inflated."],
      ["V7", "Jack and tyre-changing equipment are present and functional."],
      ["V8", "Horn is operational."],
      ["V9", "All lights function correctly — headlights, brake lights, taillights, indicators."],
      ["V10", "Seat belts are in good condition with no signs of excessive wear."],
      ["V11", "Brakes, including the park or hand brake, have been checked and function properly."],
      ["V12", "No fuel, coolant or chemical leaks present."],
      ["V13", "All loose items inside the vehicle have been secured."],
    ],
  },
  {
    id: "emergency",
    title: "Safety and emergency equipment",
    mandatory: true,
    rows: [
      ["E1", "4x4 recovery equipment is in good condition and stowed correctly."],
      ["E2", "Tow ball is securely and correctly attached."],
      ["E3", "Fire extinguisher is present, in date and in working order."],
      ["E4", "First aid kit is fully stocked and located within the vehicle."],
      ["E5", "Snake bite / pressure immobilisation bandages carried and in date."],
      ["E6", "Air compressor is operational."],
      ["E7", "Satellite phone or In-Reach carried, tested and charged."],
      ["E8", "UHF radio fitted, tested and channel agreed with the crew."],
      ["E9", "High-vis vest, torch and spare batteries carried."],
    ],
  },
  {
    id: "travel",
    title: "Travel preparation",
    mandatory: true,
    rows: [
      ["T1", "Field plan has been reviewed and understood."],
      ["T2", "All field equipment has been inspected and packed appropriately."],
      ["T3", "Minimum 10 L of water and adequate snacks have been packed."],
      ["T4", "Load has been secured and covered appropriately."],
      ["T5", "Communication Officer has been notified via text message prior to travel."],
      ["T6", "Associated field staff have been informed of your departure and meeting location."],
      ["T7", "Vehicle registration is current and driver's licence is valid."],
      ["T8", "Vehicle is roadworthy and safe to operate."],
      ["T9", "Driver is fit, healthy and capable of undertaking the journey and fieldwork."],
      ["T10", "Journey Management Plan completed where travel triggers apply."],
    ],
  },
  {
    id: "conditions",
    title: "Pre-departure fieldwork checks",
    mandatory: true,
    rows: [
      ["P1", "Weather conditions. The forecast for the project location has been reviewed and conditions are safe to proceed."],
      ["P2", "Route hazards. The Hazards Near Me app has been checked for hazards along the travel route."],
      ["P3", "Fire Near Me and fire danger rating. The rating for both the project location and travel route has been assessed, and there are no fires on route or within the project area (20 km radius)."],
      ["P4", "Live traffic. The live traffic app or information for the travel route has been assessed."],
      ["P5", "Lightning. The lightning radar for the project location has been reviewed and conditions are safe to proceed."],
      ["P6", "Air quality. The air quality for the project location has been reviewed and conditions are safe to proceed."],
      ["P7", "Journey plan. The journey plan has been reviewed and is understood."],
      ["P8", "Emergency+ app is installed on your device."],
    ],
  },
].map((section) => ({
  ...section,
  rows: section.rows.map(([id, check]) => ({ id, check })),
}));

export const PRE_MOBILISATION_ROWS = PRE_MOBILISATION_SECTIONS.flatMap((section) => section.rows);
export const PRE_MOBILISATION_ROW_IDS = PRE_MOBILISATION_ROWS.map((row) => row.id);

// Separate from the original 40 controlled rows; never infer answers from them.
export const PRE_FIELDWORK_BIOLOGICAL_SECTION = {
  id: "biological",
  title: "Pre-fieldwork biological hazard checklist",
  rows: [
    ["B1", "Site information and client hazard information reviewed"],
    ["B2", "Previous vector observations / hotspots checked"],
    ["B3", "Season, rainfall, humidity, vegetation and water conditions considered"],
    ["B4", "Animal activity, faeces, carcasses, nests and hives considered"],
    ["B5", "Contaminated water, soil, sediment or mould risks assessed"],
    ["B6", "Relevant public health alerts checked"],
    ["B7", "Site-specific risk assessment / SWMS / JSA completed and communicated"],
    ["B8", "Access, evacuation, nearest medical facility and retrieval time confirmed"],
    ["B9", "Mobile / satellite communications tested and check-in plan confirmed"],
    ["B10", "Team consultation and relevant individual emergency plans addressed confidentially"],
    ["B11", "PPE, clothing, repellent and hygiene supplies checked"],
    ["B12", "First aid kit and hazard-specific supplies checked"],
    ["B13", "Emergency contacts, GPS coordinates and site ERP available"],
    ["B14", "Toolbox talk completed, including snakebite and anaphylaxis response where relevant"],
    ["B15", "Decontamination, clothing and equipment cleaning arrangements planned"],
  ].map(([id, check]) => ({ id, check })),
};
export const PRE_FIELDWORK_BIOLOGICAL_ROW_IDS = PRE_FIELDWORK_BIOLOGICAL_SECTION.rows.map((row) => row.id);

export const PRE_MOBILISATION_SOURCE_LINKS = [
  { label: "Bureau of Meteorology", purpose: "Weather information and warnings", href: "https://www.bom.gov.au/" },
  { label: "NSW RFS — Fires Near Me", purpose: "Fire alerts, warnings and fire danger ratings", href: "https://www.rfs.nsw.gov.au/" },
  { label: "Live Traffic NSW", purpose: "Road closures, incidents and live traffic", href: "https://www.livetraffic.com/" },
  { label: "Air Quality NSW", purpose: "Air quality index and smoke advice", href: "https://www.airquality.nsw.gov.au/" },
  { label: "NSW SES — Hazards Near Me", purpose: "Floods, storms and tsunami alerts", href: "https://www.ses.nsw.gov.au/" },
  { label: "Essential Energy", purpose: "Live storm tracker and outages", href: "https://www.essentialenergy.com.au/" },
];

const FIELD_LIMITS = {
  date: 10,
  project: 160,
  jobNumber: 80,
  location: 240,
  departureTime: 5,
  expectedReturnTime: 5,
  completedBy: 120,
  additionalStaff: 1000,
  communicationOfficer: 160,
  vehicleRegistration: 32,
  vehicleType: 40,
  odometer: 32,
  vehicleLogBook: 16,
  weatherConditions: 2000,
  comments: 2000,
  fireDangerRating: 240,
  lightningStormActivity: 240,
  mobileCoverage: 500,
  name: 120,
  position: 120,
  signedAt: 40,
  signature: 1_500_000,
  failedItemsAction: 4000,
  action: 1000,
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function stringField(value, field, { required = false, pattern = null } = {}) {
  if (typeof value !== "string") return required ? null : "";
  const trimmed = value.trim();
  if (required && !trimmed) return null;
  if (trimmed.length > FIELD_LIMITS[field]) return null;
  if (pattern && trimmed && !pattern.test(trimmed)) return null;
  return trimmed;
}

function normaliseDate(value) {
  const date = stringField(value, "date", { required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ });
  return date || null;
}

function normaliseTime(value, field) {
  const time = stringField(value, field, { required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
  return time || null;
}

function normaliseRows(value, ids, outcomes) {
  if (!Array.isArray(value) || value.length !== ids.length) return null;
  const rows = Array.from(value, (row, index) => {
    if (!isPlainObject(row) || unknownKeys(row, ["id", "outcome", "action"]).length) return null;
    if (row.id !== ids[index] || !outcomes.includes(row.outcome) || typeof row.action !== "string") return null;
    const action = stringField(row.action, "action");
    return action === null ? null : { id: row.id, outcome: row.outcome, action };
  });
  return rows.some((row) => !row) ? null : rows;
}

/**
 * Validate and reduce a client payload to the exact controlled document shape.
 * The route must only invoke this function for form_type=pre_mobilisation so
 * unrelated generic WHS forms retain their current permissive details payload.
 */
export function normalisePreMobilisationDetails(value) {
  const errors = [];
  if (!isPlainObject(value)) return { errors: ["Checklist details must be an object."], details: null };

  const allowedTopLevel = ["documentCode", "documentRevision", "metadata", "checks", "biologicalChecks", "conditions", "approval", "proceedStatus"];
  const extraTopLevel = unknownKeys(value, allowedTopLevel);
  if (extraTopLevel.length) errors.push("Checklist contains unsupported fields.");
  if (value.documentCode !== PRE_MOBILISATION_DOCUMENT_CODE || value.documentRevision !== PRE_MOBILISATION_DOCUMENT_REVISION) {
    errors.push(`Only ${PRE_MOBILISATION_DOCUMENT_LABEL} can be submitted.`);
  }

  const metadataInput = isPlainObject(value.metadata) ? value.metadata : null;
  const conditionInput = isPlainObject(value.conditions) ? value.conditions : null;
  const approvalInput = isPlainObject(value.approval) ? value.approval : null;
  if (!metadataInput) errors.push("Project, team and vehicle details are required.");
  if (!conditionInput) errors.push("Recorded conditions are required.");
  if (!approvalInput) errors.push("Approval details are required.");

  const metadataKeys = ["project", "jobNumber", "location", "date", "departureTime", "expectedReturnTime", "completedBy", "additionalStaff", "communicationOfficer", "vehicleRegistration", "vehicleType", "odometer", "vehicleLogBook"];
  const conditionKeys = ["weatherConditions", "comments", "fireDangerRating", "lightningStormActivity", "liveTrafficHazardsChecked", "mobileCoverage"];
  const approvalKeys = ["name", "position", "signedAt", "signature", "failedItemsAction"];
  if (metadataInput && unknownKeys(metadataInput, metadataKeys).length) errors.push("Metadata contains unsupported fields.");
  if (conditionInput && unknownKeys(conditionInput, conditionKeys).length) errors.push("Conditions contain unsupported fields.");
  if (approvalInput && unknownKeys(approvalInput, approvalKeys).length) errors.push("Approval contains unsupported fields.");

  const metadata = metadataInput ? {
    project: stringField(metadataInput.project, "project", { required: true }),
    jobNumber: stringField(metadataInput.jobNumber, "jobNumber", { required: true }),
    location: stringField(metadataInput.location, "location", { required: true }),
    date: normaliseDate(metadataInput.date),
    departureTime: normaliseTime(metadataInput.departureTime, "departureTime"),
    expectedReturnTime: normaliseTime(metadataInput.expectedReturnTime, "expectedReturnTime"),
    completedBy: stringField(metadataInput.completedBy, "completedBy", { required: true }),
    additionalStaff: stringField(metadataInput.additionalStaff, "additionalStaff"),
    communicationOfficer: stringField(metadataInput.communicationOfficer, "communicationOfficer", { required: true }),
    vehicleRegistration: stringField(metadataInput.vehicleRegistration, "vehicleRegistration", { required: true }),
    vehicleType: stringField(metadataInput.vehicleType, "vehicleType", { required: true }),
    odometer: stringField(metadataInput.odometer, "odometer", { required: true }),
    vehicleLogBook: stringField(metadataInput.vehicleLogBook, "vehicleLogBook", { required: true }),
  } : null;
  if (metadata && Object.entries(metadata).some(([key, item]) => item === null || (key === "vehicleType" && !VEHICLE_TYPES.includes(item)) || (key === "vehicleLogBook" && !["Yes", "No", "N/A"].includes(item)))) {
    errors.push("Project, team and vehicle fields are missing or invalid.");
  }

  const conditions = conditionInput ? {
    weatherConditions: stringField(conditionInput.weatherConditions, "weatherConditions", { required: true }),
    comments: stringField(conditionInput.comments, "comments"),
    fireDangerRating: stringField(conditionInput.fireDangerRating, "fireDangerRating", { required: true }),
    lightningStormActivity: stringField(conditionInput.lightningStormActivity, "lightningStormActivity", { required: true }),
    liveTrafficHazardsChecked: conditionInput.liveTrafficHazardsChecked === true,
    mobileCoverage: stringField(conditionInput.mobileCoverage, "mobileCoverage", { required: true }),
  } : null;
  if (conditions && (
    Object.values(conditions).some((item) => item === null)
    || !WEATHER_CONDITIONS.includes(conditions.weatherConditions)
    || !FIRE_DANGER_RATINGS.includes(conditions.fireDangerRating)
    || !MOBILE_COVERAGE_OPTIONS.includes(conditions.mobileCoverage)
    || conditions.liveTrafficHazardsChecked !== true
  )) errors.push("Required conditions are missing or invalid.");

  const approval = approvalInput ? {
    name: stringField(approvalInput.name, "name", { required: true }),
    position: stringField(approvalInput.position, "position", { required: true }),
    signedAt: stringField(approvalInput.signedAt, "signedAt", { required: true, pattern: /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/ }),
    signature: stringField(approvalInput.signature, "signature", { required: true, pattern: /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/ }),
    failedItemsAction: stringField(approvalInput.failedItemsAction, "failedItemsAction"),
  } : null;
  if (approval && Object.entries(approval).some(([key, item]) => key !== "failedItemsAction" && !item)) errors.push("Sign-off name, position, date/time and signature are required.");

  const checks = normaliseRows(value.checks, PRE_MOBILISATION_ROW_IDS, CHECK_OUTCOMES);
  if (!checks) {
    errors.push(`All ${PRE_MOBILISATION_ROW_IDS.length} controlled checklist rows are required.`);
    errors.push("Checklist rows must match the current controlled document in order, with Pass, Fail or N/A and a text action field.");
  }
  const biologicalChecks = normaliseRows(value.biologicalChecks, PRE_FIELDWORK_BIOLOGICAL_ROW_IDS, BIOLOGICAL_CHECK_OUTCOMES);
  if (!biologicalChecks) {
    errors.push(`All ${PRE_FIELDWORK_BIOLOGICAL_ROW_IDS.length} biological checklist rows are required in order, with Yes, No or N/A and a text comments / action field.`);
  }

  const failedRows = (checks || []).filter((row) => row.outcome === "fail");
  const biologicalNoRows = (biologicalChecks || []).filter((row) => row.outcome === "no");
  if (failedRows.length && failedRows.some((row) => !row.action)) errors.push("Every failed checklist row requires a corrective action.");
  if (biologicalNoRows.some((row) => !row.action)) errors.push("Every biological No answer requires comments / action.");
  if ((failedRows.length || biologicalNoRows.length) && !approval?.failedItemsAction) errors.push("Failed items and biological No answers must be summarised with the Office notification and instruction received.");
  const proceedStatus = preMobilisationProceedStatus(checks, biologicalChecks);
  if (Object.prototype.hasOwnProperty.call(value, "proceedStatus") && value.proceedStatus !== proceedStatus) errors.push("Proceed status is calculated from the checklist outcomes and biological answers.");

  if (errors.length) return { errors: [...new Set(errors)], details: null };
  return {
    errors: [],
    details: {
      documentCode: PRE_MOBILISATION_DOCUMENT_CODE,
      documentRevision: PRE_MOBILISATION_DOCUMENT_REVISION,
      metadata,
      checks,
      biologicalChecks,
      conditions,
      approval,
      proceedStatus,
    },
  };
}

export function createEmptyPreMobilisationForm() {
  return {
    documentCode: PRE_MOBILISATION_DOCUMENT_CODE,
    documentRevision: PRE_MOBILISATION_DOCUMENT_REVISION,
    metadata: {
      project: "", jobNumber: "", location: "", date: "", departureTime: "", expectedReturnTime: "", completedBy: "", additionalStaff: "", communicationOfficer: "", vehicleRegistration: "", vehicleType: "", odometer: "", vehicleLogBook: "",
    },
    checks: PRE_MOBILISATION_ROW_IDS.map((id) => ({ id, outcome: "", action: "" })),
    biologicalChecks: PRE_FIELDWORK_BIOLOGICAL_ROW_IDS.map((id) => ({ id, outcome: "", action: "" })),
    conditions: { weatherConditions: "", comments: "", fireDangerRating: "", lightningStormActivity: "", liveTrafficHazardsChecked: false, mobileCoverage: "" },
    approval: { name: "", position: "", signedAt: "", signature: "", failedItemsAction: "" },
    proceedStatus: "cleared",
  };
}

export const PRE_MOBILISATION_REQUIRED_METADATA = ["project", "jobNumber", "location", "date", "departureTime", "expectedReturnTime", "completedBy", "communicationOfficer", "vehicleRegistration", "vehicleType", "odometer", "vehicleLogBook"];
export const PRE_MOBILISATION_REQUIRED_CONDITIONS = ["weatherConditions", "fireDangerRating", "lightningStormActivity", "mobileCoverage"];

export function preMobilisationProceedStatus(checks, biologicalChecks = []) {
  const failed = Array.isArray(checks) && checks.some((check) => check?.outcome === "fail");
  const biologicalNo = Array.isArray(biologicalChecks) && biologicalChecks.some((check) => check?.outcome === "no");
  return failed || biologicalNo ? "blocked" : "cleared";
}

export function preMobilisationValidationMessages(form) {
  const messages = [];
  const metadata = form?.metadata || {};
  const conditions = form?.conditions || {};
  const approval = form?.approval || {};
  if (PRE_MOBILISATION_REQUIRED_METADATA.some((key) => !String(metadata[key] || "").trim())) messages.push("Complete all required project, team and vehicle fields.");
  if (PRE_MOBILISATION_REQUIRED_CONDITIONS.some((key) => !String(conditions[key] || "").trim()) || conditions.liveTrafficHazardsChecked !== true) messages.push("Record each required pre-departure condition.");
  const checks = Array.isArray(form?.checks) ? form.checks : [];
  const biologicalChecks = Array.isArray(form?.biologicalChecks) ? form.biologicalChecks : [];
  if (!normaliseRows(checks, PRE_MOBILISATION_ROW_IDS, CHECK_OUTCOMES)) messages.push("Choose Pass, Fail or N/A for every controlled checklist row in order.");
  if (!normaliseRows(biologicalChecks, PRE_FIELDWORK_BIOLOGICAL_ROW_IDS, BIOLOGICAL_CHECK_OUTCOMES)) messages.push("Choose Yes, No or N/A for every biological checklist row in order.");
  const failed = checks.filter((check) => check?.outcome === "fail");
  const biologicalNo = biologicalChecks.filter((check) => check?.outcome === "no");
  if (failed.some((check) => !String(check.action || "").trim())) messages.push("Every failed item needs a corrective action.");
  if (biologicalNo.some((check) => !String(check.action || "").trim())) messages.push("Every biological No answer needs comments / action.");
  if ((failed.length || biologicalNo.length) && !String(approval.failedItemsAction || "").trim()) messages.push("Summarise failed items and biological No answers, Office notification and instruction received.");
  if (![approval.name, approval.position, approval.signedAt, approval.signature].every((item) => String(item || "").trim())) messages.push("Complete the sign-off name, position, date/time and signature.");
  return messages;
}
