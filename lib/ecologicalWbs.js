/**
 * Standard editable work-breakdown structures for Ecology Consulting deliverables.
 *
 * These are deliberately activities rather than timesheet categories. Project
 * Managers generate the relevant WBS from a selected deliverable, then tailor
 * staff, dates, hours, dependencies, and optional work before approval.
 */
export const TIME_CATEGORIES = [
  "Desktop/Field plan",
  "Preparation (pre-fieldwork, pre-report set up)",
  "Fieldwork & Travel",
  "Data Management",
  "Reporting",
  "GIS/Mapping",
  "QA Review",
  "Client Consultation",
  "General Project Management",
  "Other",
];

const activity = (title, category, detail, defaultHours = null, optional = false) => ({
  title,
  category,
  detail,
  defaultHours,
  optional,
});

const COMMON = [
  activity("Project initiation and pathway confirmation", "General Project Management", "Confirm the brief, site, footprint, decision pathway, scope, assumptions, exclusions, program and client contacts.", 1),
  activity("Internal project kickoff", "Preparation (pre-fieldwork, pre-report set up)", "Confirm roles, budget, deliverables, dependencies, data requirements, risks and escalation arrangements.", 1),
  activity("Review project brief, plans and existing material", "Desktop/Field plan", "Review scope, current plans, previous ecological reports, approvals, conditions and information gaps.", 2),
  activity("Desktop ecological research and constraints review", "Desktop/Field plan", "Review ecological databases, threatened species and community records, mapping, imagery, waterways, habitat and planning constraints.", 3),
  activity("Field plan, access and WHS preparation", "Preparation (pre-fieldwork, pre-report set up)", "Confirm access, field team, equipment, methodology, permits, field forms, weather and emergency arrangements.", 2),
  activity("Field data upload and QA", "Data Management", "Upload, name and quality-check field data, photographs, GPS tracks and observations; identify missing information.", 1),
  activity("GIS setup, mapping and spatial QA", "GIS/Mapping", "Set up project GIS, map boundaries, field data, ecological constraints and required figures; undertake coordinate, attribute and geometry QA.", 3),
  activity("Internal pre-report meeting", "Preparation (pre-fieldwork, pre-report set up)", "Confirm survey completeness, selected methodology, report structure, technical inputs, mapping and allocated report sections.", 0.5),
  activity("Draft report and supporting documentation", "Reporting", "Prepare the assessment narrative, methods, results, impact assessment, recommendations, figures, tables, appendices and supporting data.", 6),
  activity("Internal technical and project-manager QA", "QA Review", "Check technical method, calculations, GIS, references, report consistency, deliverable requirements and client assumptions.", 2),
  activity("Address QA comments and finalise", "Reporting", "Resolve approved technical, GIS, data and formatting comments and prepare the final report package.", 2),
  activity("Client draft submission and feedback", "Client Consultation", "Issue the agreed draft, record comments, hold feedback discussion if needed and confirm action owner and due date.", 1),
  activity("Final issue, data handover and close-out", "General Project Management", "Issue agreed final deliverables, hand over data, record remaining actions and prepare the project for close-out.", 1),
];

const withFieldwork = (title, detail, hours = 8) => [
  ...COMMON.slice(0, 5),
  activity(title, "Fieldwork & Travel", detail, hours),
  ...COMMON.slice(5),
];

export const ECOLOGICAL_WBS = {
  BAR_BSUD: withFieldwork(
    "ACT biodiversity field assessment",
    "Undertake vegetation, habitat and threatened-species assessment; record habitat structures, weeds, condition, photographs, GPS and field observations.",
  ).flatMap((item) => item.title === "Draft report and supporting documentation" ? [
    activity("ACT biodiversity impact assessment", "Reporting", "Assess direct and indirect impacts, threatened species, ecological communities, avoidance, mitigation, residual risks and approval/referral needs.", 4),
    activity("BSUD assessment and design advice", "Reporting", "Review design, landscaping and open space; recommend habitat retention, native planting, connectivity, fauna movement and low-impact design measures.", 4),
    item,
  ] : [item]),

  BDAR: withFieldwork(
    "BAM field assessment and targeted survey",
    "Undertake BAM vegetation integrity and floristic plot work, threatened-species and habitat surveys, and record field evidence, GPS and photographs.",
  ).flatMap((item) => item.title === "GIS setup, mapping and spatial QA" ? [
    item,
    activity("BAM data, BAM-C and BOS Portal preparation", "Data Management", "Compile and QA BAM data, assessment areas, species and ecosystem credit inputs, spatial layers, metadata and any BOS Portal material.", 3),
  ] : item.title === "Draft report and supporting documentation" ? [
    activity("BAM-C calculations and biodiversity assessment", "Reporting", "Verify BAM inputs, credit calculations, impact assessment, limitations, assumptions and independent technical review requirements.", 4),
    activity("BDAR drafting", "Reporting", "Prepare methodology, field results, vegetation zones, PCT and habitat assessment, BAM-C results, avoidance, mitigation, offsets, maps and appendices.", 8),
  ] : [item]),

  FFA: withFieldwork(
    "Flora, fauna and habitat survey",
    "Undertake vegetation, flora, fauna habitat and relevant targeted survey work; record habitat features, weeds, disturbance, GPS and photographs.",
  ).flatMap((item) => item.title === "Draft report and supporting documentation" ? [
    activity("Flora and Fauna Assessment drafting", "Reporting", "Prepare methods, results, ecological constraints, impact assessment, mitigation, rehabilitation and monitoring recommendations.", 7),
  ] : [item]),

  FFA_REF: withFieldwork(
    "REF ecology fieldwork and targeted surveys",
    "Undertake vegetation and fauna habitat assessment, targeted surveys where required, and record field evidence and project constraints.",
  ).flatMap((item) => item.title === "Draft report and supporting documentation" ? [
    activity("REF ecology impact assessment", "Reporting", "Assess direct, indirect and cumulative construction impacts, connectivity, waterways, weeds, noise, lighting and fauna interactions.", 4),
    activity("REF ecology chapter and specialist coordination", "Reporting", "Prepare ecology chapter, appendices and data for the broader REF; coordinate ecological commitments with other specialist inputs.", 6),
    activity("Integrated REF review and approval support", "QA Review", "Check integrated REF ecological accuracy and respond to client, planner or determining-authority questions.", 2),
  ] : [item]),

  BOS: [
    activity("BOS scope and eligibility review", "Desktop/Field plan", "Confirm clearing footprint, project decision, biodiversity certification, BAR, BAM-C, BOS pathway, data limitations, fee and exclusions.", 2),
    activity("Desktop data and ecological constraints", "Desktop/Field plan", "Review vegetation, habitat, threatened-species, BioNet, mapped ecological condition, previous assessments and likely biodiversity obligations.", 2),
    activity("Site verification and evidence capture", "Fieldwork & Travel", "Verify vegetation, habitat mapping and proposed impact areas where field verification is within scope.", 4, true),
    activity("BOS analysis, options and risk review", "Reporting", "Assess applicable requirements, potential impacts, avoidance, offset, credit and compliance options, uncertainty and further investigations.", 4),
    activity("BOS assessment memo and maps", "Reporting", "Prepare project background, evidence reviewed, methods, constraints, pathway assumptions, recommendations, maps and appendices.", 4),
    activity("Technical review and final advice", "QA Review", "Check advice, assumptions, current terminology, figures and approval-risk statements before final issue.", 1.5),
    activity("Client issue and next-step briefing", "Client Consultation", "Issue final memo and confirm actions, approvals, further investigation and program responsibilities.", 0.5),
  ],

  VMP: withFieldwork(
    "Vegetation management field assessment",
    "Map management zones and condition; assess weeds, regeneration, canopy, erosion, drainage, habitat constraints and management priorities.",
  ).flatMap((item) => item.title === "Draft report and supporting documentation" ? [
    activity("Vegetation management prescriptions and implementation schedule", "Reporting", "Develop zones, weed, restoration, planting, erosion, habitat, biosecurity, seasonal, monitoring and responsibility recommendations.", 5),
  ] : [item]),

  PCA: [
    activity("Clearing plan and approval review", "Desktop/Field plan", "Review clearing footprint, latest plans, consent conditions, environmental management plans, staging, access and required pre-clearing deliverable.", 2),
    activity("Pre-clearing plan, access and WHS preparation", "Preparation (pre-fieldwork, pre-report set up)", "Prepare boundary plans, field maps, data sheets, team, equipment, clearing schedule, contractor contacts and safety controls.", 1.5),
    activity("Pre-clearing field assessment", "Fieldwork & Travel", "Inspect boundaries, habitat trees, nests, dens, burrows, rocks, logs, fauna signs, no-go areas and clearing controls; record GPS and photographs.", 6),
    activity("Clearing controls and habitat-feature register", "GIS/Mapping", "Prepare boundary, habitat-feature, tree and no-go mapping plus the clearing control schedule.", 3),
    activity("Pre-clearing report and recommendations", "Reporting", "Prepare assessment, habitat-feature register, fauna management recommendations, clearing controls and commencement conditions.", 5),
    activity("Technical QA and issue", "QA Review", "Review field evidence, maps, conditions and final recommendations before issue.", 1.5),
  ],

  CLEARING_SUPERVISION: [
    activity("Pre-mobilisation and supervision planning", "Preparation (pre-fieldwork, pre-report set up)", "Review pre-clearing material, conditions, contractor program, fauna arrangements, reporting forms and daily field controls.", 2),
    activity("Clearing commencement checks", "Fieldwork & Travel", "Confirm limits, exclusion zones, habitat retention, contractor briefing, fauna rescue equipment, contacts and weather conditions.", 2),
    activity("Daily ecological clearing supervision", "Fieldwork & Travel", "Create one activity per clearing day or shift for supervision, travel, field records, fauna observations, directions and GPS/photo evidence.", 8),
    activity("Incident and variation management", "General Project Management", "Record non-conformances, fauna incidents, unexpected features, stop-work advice, corrective action and scope variations.", 1, true),
    activity("Clearing supervision data and registers", "Data Management", "Compile daily records, cleared and retained tree data, fauna records, photographs, GPS and outstanding actions.", 1),
    activity("Clearing supervision report", "Reporting", "Prepare compliance, incidents, fauna observations, corrective actions, quantities, dates, maps, photographs and schedules.", 5),
    activity("Technical review, issue and close-out", "QA Review", "Review final records and report, issue to stakeholders and close remaining actions.", 1.5),
  ],

  SBDAR: withFieldwork(
    "Streamlined BDAR site inspection and targeted fieldwork",
    "Verify clearing footprint, vegetation, habitat and ecological constraints; confirm if additional work or escalation to a full BDAR is required.",
  ).flatMap((item) => item.title === "Draft report and supporting documentation" ? [
    activity("Streamlined assessment and calculations", "Reporting", "Apply the approved streamlined method, verify eligibility, document assumptions and determine any credit or offset requirements.", 4),
    activity("Streamlined BDAR drafting and submission", "Reporting", "Prepare report, constraints, vegetation and impact maps, avoidance and mitigation measures, QA and agreed submission support.", 6),
  ] : [item]),

  DUE_DILIGENCE: [
    activity("Transaction and assessment scope", "General Project Management", "Confirm transaction purpose, property boundary, decision date, reliance limitations, confidentiality, level of assessment, fee and exclusions.", 1.5),
    activity("Legal, planning and desktop ecology review", "Desktop/Field plan", "Review planning instruments, approvals, vegetation and biodiversity constraints, prior reports, protected matters, obligations and information gaps.", 3),
    activity("GIS, imagery and historic land-use review", "GIS/Mapping", "Review imagery, mapping, historical change, disturbance, habitat, waterways and development constraints; prepare a preliminary constraints map.", 3),
    activity("Site inspection and evidence capture", "Fieldwork & Travel", "Undertake a walkover and verify vegetation, habitat, weeds, drainage, erosion, clearing history and observable compliance risks if within scope.", 4, true),
    activity("Ecological risk and development constraints", "Reporting", "Assess approval, clearing, survey, rehabilitation, offset, time, cost and program risks; identify critical unknowns and further investigation.", 4),
    activity("Due diligence report and decision memo", "Reporting", "Prepare findings, limitations, risks, priority actions, maps, photographs and decision implications.", 4),
    activity("Technical review and client briefing", "QA Review", "Review references, risk rating and advice before final issue and client briefing.", 1.5),
  ],

  PMP: [
    activity("Project scope, pathway and client information review", "Desktop/Field plan", "Review the brief, plans, approvals, constraints, risks, assumptions, dependencies and client objectives.", 2),
    activity("Project team kickoff and resource planning", "General Project Management", "Confirm roles, capacity, budget, communications, escalation, deliverables and key dates.", 1),
    activity("Project management plan drafting", "Reporting", "Prepare objectives, scope, program, resourcing, risk, quality, communications, approvals and change-control approach.", 4),
    activity("Internal review and sign-off", "QA Review", "Review scope, budget, responsibilities, milestones and controls before issue.", 1),
    activity("Client issue and project setup", "Client Consultation", "Issue the approved plan, confirm client decisions and set up agreed project controls.", 1),
  ],

  MEMO: [
    activity("Scope, question and source review", "Desktop/Field plan", "Confirm the decision required, evidence base, assumptions, limitations and relevant authority or planning context.", 1),
    activity("Desktop research and analysis", "Desktop/Field plan", "Review ecological, planning, legislative and technical sources required for the advice.", 2),
    activity("Memo drafting", "Reporting", "Prepare concise findings, risks, assumptions, recommendations and next steps.", 2),
    activity("Technical QA and final issue", "QA Review", "Check accuracy, references, consistency and client-facing caveats before issue.", 1),
  ],
};

export function wbsForDeliverable(code, fallback = []) {
  const standard = ECOLOGICAL_WBS[String(code || "").toUpperCase()];
  return Array.isArray(standard) && standard.length ? standard : fallback;
}

export function activityDetail(activityItem) {
  const detail = String(activityItem?.detail || "").trim();
  const optional = activityItem?.optional ? " Optional activity — remove it if it is not relevant to the agreed scope." : "";
  return `${detail}${optional}`.trim() || null;
}

export function activityHours(activityItem) {
  const value = Number(activityItem?.defaultHours);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
