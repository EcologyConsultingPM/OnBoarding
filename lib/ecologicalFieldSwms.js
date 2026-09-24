export const ECOLOGICAL_FIELD_SWMS_VERSION = "1.0";

export const ECOLOGICAL_FIELD_SWMS_BASE_CONTROLS = [
  "Use this selector for ecological survey and observation work only. It does not authorise construction, plant operation, traffic control, electrical work, asbestos disturbance, confined-space rescue, diving or any work excluded by a selected source SWMS.",
  "Before mobilisation and at the daily pre-start, confirm the work area, access route, team roles, Emergency Response Plan, communications, equipment and any site or Principal Contractor controls.",
  "Use a safer observation method or do not proceed where the field hazard cannot be eliminated or controlled. Reassess when the weather, location, operations or survey method changes.",
  "Verify that workers are fit, trained and authorised for the selected work. Confirm task PPE, first aid, communication and rescue equipment are present and serviceable; tag out faulty equipment.",
  "Stop work, move to the nominated safe location, notify the Field Lead and Principal Contractor, and do not recommence until the risk is controlled and communicated.",
  "Use the site-specific Emergency Response Plan in an emergency. Make the area safe for responders, call 000 or 112 or use InReach/PLB where required, account for people, report the event and review the controls.",
];

export const ECOLOGICAL_FIELD_SWMS_HAZARDS = [
  {
    id: "fall_risk",
    documentCode: "EC-SWMS01",
    title: "Fall risk over two metres",
    prompt: "Will the activity occur near a drop-off, elevated or unstable edge, culvert, bridge, embankment, batter, cliff line, creek bank or retaining structure?",
    controls: [
      "Use safe ground, remote observation, binoculars, cameras, extendable equipment or existing data instead of approaching an edge wherever practicable.",
      "Keep to stable ground, defined tracks and existing protected access. Establish and observe no-go zones and safe setbacks around edges, steep terrain, unstable ground and eroded or undercut banks.",
      "Plan access, use a buddy system, retain line of sight, keep hands free where possible and stage equipment outside the fall zone. Park vehicles clear of embankments, culvert headwalls and edges.",
      "Do not use a fall-arrest system unless an engineer-rated anchorage is provided and verified by the Principal Contractor and the operator holds current Working at Heights competency.",
      "Where immersion risk exists, also select Water / drowning risk (EC-SWMS18).",
    ],
    stopWork: [
      "Ground or edge is unstable, wet, loose or slippery.",
      "Rain, fog, smoke, low light or high wind reduces safe visibility or balance.",
      "A required fall-arrest anchorage is unavailable or unverified, communication or visual contact is lost, or a worker feels unsafe.",
    ],
  },
  {
    id: "asbestos_observation",
    documentCode: "EC-SWMS04",
    title: "Known or suspected asbestos — observation only",
    prompt: "Is the survey at a site where asbestos or asbestos-containing material may be present in structures, soil or fill?",
    controls: [
      "The ecological activity is observation-only. Do not disturb, handle, remove or interfere with asbestos-containing material; do not excavate, rake, lift sheeting or disturb soil or fill.",
      "Review the current asbestos register and asbestos management plan. Obtain Principal Contractor confirmation of approved observation-only scope, asbestos areas and exclusion zones.",
      "Use remote observation or existing data, avoid asbestos work zones and dusty areas, follow designated access, signage and barricades, and do not work concurrently with or downwind of asbestos removal.",
      "Follow site decontamination requirements. Do not place equipment or clothing on potentially contaminated ground. Use PPE only as directed by the Principal Contractor.",
    ],
    stopWork: [
      "Suspected asbestos is identified or the asbestos register is unavailable, out of date or unclear.",
      "Removal works start nearby, containment or barricades are damaged, dust is visible, signage is missing or an exclusion zone is breached.",
      "Do not resume until the Principal Contractor gives written clearance.",
    ],
  },
  {
    id: "confined_space",
    documentCode: "EC-SWMS06",
    title: "Work in or near a confined space",
    prompt: "Will the survey occur in or near a culvert, stormwater drain, bridge void, underpass cavity, pit, pipe or enclosed waterway, or is its confined-space classification uncertain?",
    controls: [
      "Avoid entry wherever possible. Inspect from the access point using remote cameras, borescopes, torches, extendable equipment or existing data.",
      "Treat uncertainty as a confined space. Entry requires current Principal Contractor-authorised permit, identified hazards and controls, atmospheric results, authorised entrants and entry duration.",
      "Use at least two people with a dedicated standby person outside. Maintain continuous communication and entry tracking. The standby person performs no other task and must never enter the space.",
      "Use calibrated atmospheric testing and continuous monitoring, adequate ventilation, required isolation/lock-out, suitable lighting and retrieval arrangements. Ecology Consulting personnel do not perform confined-space rescue.",
    ],
    stopWork: [
      "Atmospheric alarm or oxygen outside 19.5%–23.5%.",
      "Ventilation fails, water rises, rainfall occurs upstream, structural instability is observed, lighting fails, the permit expires or conditions change.",
      "Communication with the standby person is lost or an unidentified hazard is present.",
    ],
  },
  {
    id: "tunnel",
    documentCode: "EC-SWMS08",
    title: "Work in or near a tunnel or underpass",
    prompt: "Will ecological observation, fauna assessment, habitat inspection or device deployment/retrieval occur in, at or near a tunnel, culvert or underpass?",
    controls: [
      "Limit work to ecological observation and survey. Avoid entry with remote methods where practicable. Obtain written confirmation of whether the space is confined or non-confined; select EC-SWMS06 when required or uncertain.",
      "Complete a go/no-go assessment for atmosphere, structural integrity, water risk, lighting and communications. Confirm Principal Contractor controls, entry permission, emergency exits and muster point.",
      "Use at least a two-person team with an On-Ground Communications Officer outside. Maintain continuous redundant communications, two independent lights per person and a safe evacuation trigger for water or condition changes.",
      "Do not interfere with plant, services or isolation systems. Do not handle fauna unless trained and authorised. Apply the required hygiene and PPE controls around guano or contaminated material.",
    ],
    stopWork: [
      "Air-quality alarm, illness symptoms, rising water, flood/flow risk, structural instability, inadequate lighting or an unidentified hazard.",
      "Plant operates without notice, communication is lost or another change makes conditions uncontrolled.",
    ],
  },
  {
    id: "energised_electrical",
    documentCode: "EC-SWMS12",
    title: "Energised electrical installations or services",
    prompt: "Will survey, pre-clearing, habitat inspection, clearing supervision or fauna work occur on or near energised overhead or underground electrical assets or services?",
    controls: [
      "Do not undertake electrical work or enter electrical No-Go Zones. Confirm service locations and treat unverified services as live; do not excavate in service corridors.",
      "Complete site electrical induction and maintain the applicable safe approach and exclusion distances. Mark zones and work from safe ground using remote observation wherever practicable.",
      "Keep GPS poles, tripods, cameras, vehicles and long equipment clear of assets; carry long equipment horizontally. Do not approach vegetation contacting powerlines.",
      "Remain an observer during clearing work and coordinate with authorised plant operators and spotters. For plant exposure, also select Powered mobile plant (EC-SWMS16).",
    ],
    stopWork: [
      "An exclusion or approach distance is or may be breached, asset voltage/location is uncertain, or zones are unclear or unconfirmed.",
      "Unsafe plant movement, lost communication, vegetation contacting powerlines, lightning within 10 km, high wind, poor visibility or unsafe wet conditions.",
    ],
  },
  {
    id: "traffic_corridor",
    documentCode: "EC-SWMS15",
    title: "Road, rail or other live traffic corridor",
    prompt: "Will ecological fieldwork, pre-clearing survey, observation or clearing supervision occur on, in or adjacent to a road, rail or other non-pedestrian traffic corridor?",
    controls: [
      "Avoid live corridors through remote observation, existing data, designated safe areas, closures or approved low-traffic periods wherever practicable.",
      "Do not start without the required approvals, daily briefing and verified Principal Contractor traffic controls. Ecology Consulting personnel must not perform traffic control unless trained and authorised.",
      "Stay in the designated work zone and behind approved barriers, delineation and buffers. Use designated safe parking and access paths; stop safely before recording data and keep clear of plant.",
      "Maintain communication with traffic control, plant operators and rail control where applicable. Rail access requires the Principal Contractor's authorised arrangements, rail induction and designated retreat areas.",
    ],
    stopWork: [
      "Traffic controls are missing, damaged, ineffective or breached.",
      "Traffic, rail or plant communication is lost; a train warning or unauthorised movement occurs; visibility is unsafe; fatigue affects safety; or environmental risks cannot be controlled.",
    ],
  },
  {
    id: "powered_mobile_plant",
    documentCode: "EC-SWMS16",
    title: "Powered mobile plant",
    prompt: "Will fieldwork, clearing supervision or ground-based fauna rescue occur where powered mobile plant is operating or may move?",
    controls: [
      "Ecology Consulting personnel are observers only and do not operate plant. Avoid plant work zones or use remote observation where practicable.",
      "Confirm daily SWMS/JSA, planned plant activities and exclusion zones. Maintain separation using approved barriers, controlled access points, designated pedestrian paths and spotters where required.",
      "Do not approach plant until acknowledged by the operator and stationary where required. Remain out of blind spots and never walk behind operating plant.",
      "For fauna rescue, stop and isolate plant and confirm directly with the operator before starting. Maintain the tree-felling exclusion zone and clear escape path during clearing observations.",
    ],
    stopWork: [
      "People and plant cannot be adequately separated, an exclusion zone is breached, plant operates outside a designated zone or unsafe operation is identified.",
      "Visibility is poor, communication with operator/spotter is lost, traffic controls are inadequate, or a worker feels unsafe.",
      "Plant has not been stopped and isolated before fauna rescue, or high wind, dust, smoke or rain makes clearing observation unsafe.",
    ],
  },
  {
    id: "water_drowning",
    documentCode: "EC-SWMS18",
    title: "Water or drowning risk",
    prompt: "Will the survey or monitoring task be in or near a water body or other liquid with a risk of drowning, immersion, unstable footing, unexpected depth or water rescue?",
    controls: [
      "Avoid water entry through bank, bridge or elevated observation, cameras, binoculars, remote sensors, extendable tools or existing data wherever practicable.",
      "Assess depth, flow, bank stability, hidden hazards and safe entry/exit. Establish safe setbacks around deep, fast-flowing, unstable, eroded, undercut or flood-prone water; do not enter unknown or unassessed water.",
      "Use a two-person buddy system with one person on land when another is in water. Maintain continuous contact, stable access and controlled entry. Do not carry awkward loads into water.",
      "Check weather, rainfall, upstream conditions, tide and releases. Use a PFD near deep or flowing water, non-slip footwear and required reach-or-throw equipment. No diving or unauthorised water rescue.",
    ],
    stopWork: [
      "Water level/flow rises, water is fast-flowing, flood affected or unstable, depth is unknown/unsafe, banks or substrate are unsafe, or safe egress cannot be maintained.",
      "Adverse weather or poor visibility occurs, team contact is lost, required rescue equipment/communications are absent or fail, or immediate rescue cannot be performed.",
    ],
  },
];

const HAZARD_IDS = new Set(ECOLOGICAL_FIELD_SWMS_HAZARDS.map((hazard) => hazard.id));
const cleanText = (value, max = 2000) => String(value || "").trim().slice(0, max);
const cleanRows = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
  name: cleanText(row?.name, 120),
  role: cleanText(row?.role, 120),
  acknowledged: row?.acknowledged === true,
})).filter((row) => row.name);

export function ecologicalHazardById(id) {
  return ECOLOGICAL_FIELD_SWMS_HAZARDS.find((hazard) => hazard.id === id) || null;
}

export function normaliseEcologicalFieldSwmsDetails(value) {
  const details = value && typeof value === "object" ? value : {};
  const project = cleanText(details.project, 240);
  const activity = cleanText(details.activity, 2000);
  const site = cleanText(details.site, 1000);
  const date = cleanText(details.date, 32);
  const fieldLead = cleanText(details.fieldLead, 120);
  const emergencyPlan = cleanText(details.emergencyPlan, 500);
  const musterPoint = cleanText(details.musterPoint, 600);
  const communications = cleanText(details.communications, 1200);
  const conditions = cleanText(details.conditions, 1600);
  const signature = cleanText(details.fieldLeadSignature, 360000);
  const team = cleanRows(details.team);
  const selectedHazards = [...new Set((Array.isArray(details.selectedHazards) ? details.selectedHazards : [])
    .map((id) => String(id)).filter((id) => HAZARD_IDS.has(id)))];
  const hazardDetails = Object.fromEntries(selectedHazards.map((id) => {
    const row = details.hazardDetails?.[id] || {};
    return [id, {
      reason: cleanText(row.reason, 1000),
      location: cleanText(row.location, 600),
      sourceVersion: cleanText(row.sourceVersion, 80) || "Revision 1.0",
      controlsConfirmed: row.controlsConfirmed === true,
      stopWorkBriefed: row.stopWorkBriefed === true,
    }];
  }));

  const errors = [];
  if (!project) errors.push("Enter the project name.");
  if (!activity) errors.push("Describe the ecological survey activity for today.");
  if (!site) errors.push("Enter the site or work area.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Enter the work date.");
  if (!fieldLead) errors.push("Enter the Field Lead.");
  if (!team.length) errors.push("Add at least one field team member.");
  if (team.some((member) => !member.role || !member.acknowledged)) errors.push("Record a role and acknowledgement for every listed team member.");
  if (!emergencyPlan || !musterPoint || !communications || !conditions) errors.push("Complete the emergency plan, muster point, communications and daily conditions fields.");
  if (details.baseControlsRead !== true) errors.push("Confirm the generic ecological field survey controls have been reviewed.");
  if (details.sourceDocumentsAvailable !== true) errors.push("Confirm the selected controlled SWMS documents are available to the team.");
  if (!selectedHazards.length && details.noSpecialistHazardConfirmed !== true) errors.push("Select every relevant specialist hazard, or confirm that none apply to today’s activity.");
  for (const id of selectedHazards) {
    const selection = hazardDetails[id];
    if (!selection.reason || !selection.location || !selection.controlsConfirmed || !selection.stopWorkBriefed) {
      errors.push(`Complete the location, reason and confirmations for ${ecologicalHazardById(id)?.title || id}.`);
    }
  }
  if (!signature.startsWith("data:image/png;base64,") || signature.length < 100) errors.push("The Field Lead must sign the SWMS before submission.");

  return {
    errors,
    details: {
      version: 1,
      documentCode: "EC-GEN-SWMS-001",
      documentRevision: ECOLOGICAL_FIELD_SWMS_VERSION,
      project,
      client: cleanText(details.client, 240),
      jobNumber: cleanText(details.jobNumber, 120),
      date,
      activity,
      site,
      accessEgress: cleanText(details.accessEgress, 1000),
      fieldLead,
      principalContractor: cleanText(details.principalContractor, 240),
      firstAider: cleanText(details.firstAider, 120),
      communicationOfficer: cleanText(details.communicationOfficer, 120),
      emergencyPlan,
      musterPoint,
      gpsCoordinates: cleanText(details.gpsCoordinates, 240),
      nearestCrossRoad: cleanText(details.nearestCrossRoad, 300),
      communications,
      conditions,
      team,
      selectedHazards,
      hazardDetails,
      baseControlsRead: details.baseControlsRead === true,
      sourceDocumentsAvailable: details.sourceDocumentsAvailable === true,
      noSpecialistHazardConfirmed: details.noSpecialistHazardConfirmed === true,
      changesDuringDay: cleanText(details.changesDuringDay, 2000),
      fieldLeadSignature: signature,
      signedAt: cleanText(details.signedAt, 100),
    },
  };
}
