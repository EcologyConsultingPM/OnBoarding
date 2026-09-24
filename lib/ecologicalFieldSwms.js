export const ECOLOGICAL_FIELD_SWMS_VERSION = "1.1";

export const ECOLOGICAL_FIELD_SWMS_BASE_CONTROLS = [
  "Use this selector for ecological survey and observation work only. It does not authorise construction, excavation or ground disturbance, plant operation, traffic control, electrical work, asbestos disturbance, confined-space or tunnel rescue, diving or any activity excluded by a selected controlled source SWMS.",
  "Before mobilisation and again at the daily pre-start or toolbox talk, confirm the work area, access and egress, team roles, site-specific Emergency Response Plan, communication and check-in plan, current source SWMS, relevant permits, site controls and task equipment.",
  "Apply the hierarchy of controls. Use remote observation, existing information, cameras, binoculars, drones, torches, borescopes or extendable equipment where practicable. Do not proceed into a hazard area that cannot be eliminated or adequately controlled.",
  "Confirm each worker is fit, competent, trained and authorised for the specific selected work. Verify current required credentials, inductions, PPE, first-aid, communications, monitoring and rescue equipment; tag out faulty equipment and do not use it.",
  "Maintain the required buddy, standby, visual contact, check-in, separation and supervision arrangements. Reassess and re-brief if weather, location, operations, site controls or the survey method changes.",
  "Stop work, move to the nominated safe location or muster point, notify the Field Lead and Principal Contractor or site supervisor, and do not recommence until the risk is controlled and communicated. Any worker may stop work.",
  "In an emergency, use the site-specific Emergency Response Plan. Make the area safe for responders and do not move an injured person unless there is immediate danger. Call 000 or 112, or use InReach or PLB where required; provide location and access information, account for personnel, report the event, review the source SWMS and ERP, and restock used equipment.",
];

export const ECOLOGICAL_FIELD_SWMS_HAZARDS = [
  {
    id: "fall_risk",
    documentCode: "EC-SWMS01",
    title: "Fall risk over two metres",
    prompt: "Will the activity occur near a drop-off, elevated or unstable edge, culvert, bridge, embankment, batter, cliff line, creek bank or retaining structure?",
    limits: [
      "Ecological survey and observation only. This selection does not authorise erecting, altering or dismantling scaffolding, elevating work platforms or fall-protection systems, rope access or industrial abseiling.",
      "If the fall risk cannot be eliminated or adequately controlled, complete the survey from ground level or do not proceed.",
    ],
    prerequisites: [
      "Complete the pre-field meeting, relevant site risk assessment and Daily Toolbox Talk. Confirm current training, safe access, weather, a buddy system, communications and the Emergency Response Plan before approaching the area.",
      "Use a safe travel and vehicle plan. Park on firm, level ground clear of edges, apply the handbrake, select a safe entry and exit side, and do not travel through floodwater or in uncontrolled weather conditions.",
      "If fall arrest is genuinely required, confirm the Principal Contractor has provided and verified an engineer-rated anchorage, every user has current Working at Heights competency, and the harness and lanyard were checked before use and tagged out if damaged.",
    ],
    controls: [
      "Use safe ground, remote observation, binoculars, cameras, extendable equipment or existing data instead of approaching an edge wherever practicable.",
      "Keep to stable ground, defined tracks and existing protected access. Establish and observe no-go zones and safe setbacks around edges, steep terrain, unstable ground and eroded or undercut banks.",
      "Plan and brief access. Check the ground ahead, do not walk while recording data, keep hands free where possible, limit balance-affecting loads, retain line of sight and stage equipment outside the fall zone.",
      "On steep ground, work from stable ground or the slope bottom where practicable. Test stability, use three points of contact, do not lean over edges, and check for undercutting, cracking and saturation.",
      "Where immersion risk exists, also select Water / drowning risk (EC-SWMS18), including the source requirement for a buoyancy aid and floating rescue rope.",
    ],
    crossReferences: [
      "Site-specific Emergency Response Plan; Daily Toolbox Talk; relevant field survey and remote/isolated work JSA; Journey Management and pre-travel/vehicle checks.",
      "Select EC-SWMS18 where immersion, bank or water-entry risk applies.",
    ],
    emergency: [
      "Make the area safe, do not move an injured person unless there is immediate danger, and use ropes or harnesses for controlled terrain movement only where required and personnel are trained.",
      "Field Lead coordinates evacuation and accounting. Call 000 or 112, or activate InReach or PLB if required; provide GPS, nearest cross road and a safe responder access route.",
    ],
    stopWork: [
      "Ground or edge is unstable, wet, loose or slippery; an undercut, crack or other edge instability is identified.",
      "Rain, fog, smoke, low light, high wind or fatigue reduces safe visibility, balance or movement.",
      "A required fall-arrest anchorage is unavailable or unverified, communication or visual contact is lost, or a worker feels unsafe.",
    ],
  },
  {
    id: "asbestos_observation",
    documentCode: "EC-SWMS04",
    title: "Known or suspected asbestos — observation only",
    prompt: "Is the survey at a site where asbestos or asbestos-containing material may be present in structures, soil or fill?",
    limits: [
      "The activity is strictly observation-only. Do not disturb, handle, remove or interfere with asbestos-containing material, and do not excavate, rake, lift sheeting or disturb soil or fill.",
      "Ecology Consulting does not undertake asbestos removal or remediation under this selection.",
    ],
    prerequisites: [
      "Review the current asbestos register and asbestos management plan. Obtain written Principal Contractor confirmation of the approved observation-only scope, known asbestos areas, exclusion zones and designated access.",
      "Confirm workers understand the site signage, barricades, decontamination process and the requirement to avoid concurrent or downwind asbestos-removal activity.",
    ],
    controls: [
      "Use remote observation, aerial imagery or existing data where practicable. Exclude high-risk areas and reschedule around asbestos-removal work.",
      "Access approved areas only. Avoid asbestos work zones and dusty areas, follow designated paths, signage and barricades, and keep vehicle speeds low on unsealed surfaces.",
      "Do not place equipment, bags or clothing on potentially contaminated ground. Follow the site decontamination process, remove PPE without shaking or blowing down clothing, and clean boots and equipment before leaving.",
    ],
    crossReferences: [
      "Current asbestos register, asbestos management plan, Principal Contractor controls and site decontamination/waste process.",
    ],
    emergency: [
      "If suspect asbestos or dust is identified, isolate the area, report it to the Field Lead, site supervisor and Principal Contractor, and record the location or photograph only from a safe distance if safe.",
      "Do not re-enter until the Principal Contractor provides written clearance and the site controls are re-briefed.",
    ],
    stopWork: [
      "Suspected asbestos is identified or the asbestos register is unavailable, out of date or unclear.",
      "Removal works start nearby, containment or barricades are damaged, dust is visible, signage is missing or an exclusion zone is breached.",
      "Site conditions change or the approved observation-only scope cannot be maintained.",
    ],
  },
  {
    id: "confined_space",
    documentCode: "EC-SWMS06",
    title: "Work in or near a confined space",
    prompt: "Will the survey occur in or near a culvert, stormwater drain, bridge void, underpass cavity, pit, pipe or enclosed waterway, or is its confined-space classification uncertain?",
    limits: [
      "Treat uncertainty as a confined space. Ecology Consulting personnel do not perform confined-space rescue.",
      "Do not direct or allow entry without the current Principal Contractor-authorised confined-space entry permit and the source prerequisites being met.",
    ],
    prerequisites: [
      "Avoid entry first. If entry is proposed, verify the Principal Contractor permit, space classification, risk assessment, authorised entrants, entry duration, rescue plan, signage and entry tracking.",
      "Confirm calibrated atmospheric testing before entry and continuous monitoring during entry: oxygen 19.5%–23.5%, flammable gas below 5% LEL and relevant toxic-gas monitoring.",
      "Confirm required ventilation, water and energy isolation/lock-out, intrinsically safe lighting/equipment, barriers, retrieval arrangement and a dedicated standby person outside the space.",
    ],
    controls: [
      "Inspect from the access point with remote cameras, borescopes, torches, extendable equipment, remote lighting/monitoring or existing data wherever practicable.",
      "Use at least two people with a dedicated standby person outside. Maintain continuous communication and sign-in/sign-out or tag-in/tag-out tracking. The standby person performs no other task and must never enter the space.",
      "Re-test after any interruption, control inflows and adjacent plant/traffic hazards, limit time in the space and follow the site Emergency Response Plan and rescue plan.",
    ],
    crossReferences: [
      "Principal Contractor confined-space permit, risk assessment, rescue plan, site Emergency Response Plan and relevant tunnel controls where applicable.",
    ],
    emergency: [
      "Do not enter to rescue. Activate the Principal Contractor or emergency-service planned non-entry and retrieval rescue arrangement.",
      "Make the area safe, account for entrants through the entry record and provide the emergency responders with the permit, atmospheric information and access details.",
    ],
    stopWork: [
      "Atmospheric alarm, oxygen outside 19.5%–23.5%, flammable gas at or above the source limit, or a toxic-gas concern.",
      "Ventilation fails or is interrupted, water rises, rainfall occurs upstream, structural instability is observed, lighting fails, the permit expires or conditions change.",
      "Communication with the standby person is lost, the standby is unavailable, an unidentified hazard is present or any entry prerequisite is incomplete.",
    ],
  },
  {
    id: "tunnel",
    documentCode: "EC-SWMS08",
    title: "Work in or near a tunnel or underpass",
    prompt: "Will ecological observation, fauna assessment, habitat inspection or device deployment/retrieval occur in, at or near a tunnel, culvert or underpass?",
    limits: [
      "Limit work to ecological observation and survey. Do not undertake construction, interfere with plant, services, structural elements or isolation systems.",
      "Do not enter a confined space unless authorised through the Principal Contractor confined-space permit system; select EC-SWMS06 where the space is confined or classification is uncertain.",
    ],
    prerequisites: [
      "Obtain written confirmation of confined or non-confined classification, Principal Contractor entry permission and tunnel safety controls. Complete and record a go/no-go assessment for atmosphere, structural integrity, water, lighting and communications.",
      "Confirm emergency exits, muster point, relevant lock-out/tag-out, plant non-operation during the survey, water/weather/upstream conditions, two independent lights per person and redundant communications.",
    ],
    controls: [
      "Avoid entry with cameras, torches or remote survey methods where practicable. Do not proceed on incomplete information or an uncontrolled condition.",
      "Use at least a two-person team and an On-Ground Communications Officer outside. Maintain continuous communications, stable footing and a water or condition-change evacuation trigger.",
      "Inspect for cracking, deformation, spalling or instability. Keep clear of unstable surfaces, edges and drops; do not touch or load suspect structures, and wear required head protection.",
      "Do not disturb guano, contaminated or nesting material. Apply the required hygiene, P2 respirator, disposable coveralls, gloves and decontamination controls. Do not handle fauna unless trained and authorised.",
    ],
    crossReferences: [
      "Select EC-SWMS06 where confined-space conditions apply or are uncertain. Apply water, traffic, plant or electrical source SWMS where triggered by the location or operations.",
      "Principal Contractor tunnel safety plan, entry permission, site Emergency Response Plan and communications/check-in plan.",
    ],
    emergency: [
      "Do not attempt confined-space or tunnel rescue. Evacuate to the identified safe location and activate the site Emergency Response Plan and the Principal Contractor/emergency-service rescue process.",
      "Do not move an injured person unless immediate danger requires it. Account for the team and provide responders with the entry, atmospheric and access information.",
    ],
    stopWork: [
      "Air-quality alarm, illness symptoms, rising water, flood or flow risk, structural instability, inadequate lighting or an unidentified hazard.",
      "Plant operates without notice, lock-out or isolation cannot be confirmed, communication is lost or another change makes conditions uncontrolled.",
    ],
  },
  {
    id: "energised_electrical",
    documentCode: "EC-SWMS12",
    title: "Energised electrical installations or services",
    prompt: "Will survey, pre-clearing, habitat inspection, clearing supervision or fauna work occur on or near energised overhead or underground electrical assets or services?",
    limits: [
      "Do not undertake electrical work, interfere with electrical infrastructure or controls, enter electrical No-Go Zones, excavate in service corridors or approach vegetation contacting powerlines.",
      "Treat an unverified or unidentified service as live. If the applicable exclusion distance cannot be maintained, do not proceed.",
    ],
    prerequisites: [
      "Confirm service locations using current BYDA/site information and the Principal Contractor or Network Operator requirements. Complete the site electrical induction and establish the applicable approach and exclusion distances.",
      "Mark and maintain electrical exclusion and No-Go Zones. Confirm safe access, remote observation method, communication with Field Lead, Principal Contractor, plant operators and spotters, and weather/lightning limits.",
    ],
    controls: [
      "Work from safe ground outside zones and use remote observation wherever practicable. Keep GPS poles, tripods, cameras, vehicles and long equipment clear of assets; carry long equipment horizontally.",
      "Remain an observer during clearing. Do not direct plant unless separately authorised. Where plant exposure exists, also select EC-SWMS16; for traffic exposure, select EC-SWMS15.",
      "Use daylight or adequate lighting, stable footing and the required hygiene controls around droppings, carcasses and contaminated material. Increase separation and reassess when conditions change.",
    ],
    crossReferences: [
      "Current service-location information, site electrical induction, Network Operator/Principal Contractor controls, site Emergency Response Plan and EC-SWMS16 or EC-SWMS15 when plant or traffic is present.",
    ],
    emergency: [
      "For electrical contact, remain clear of the person, plant or vegetation in contact with a conductor. Do not approach until the area is confirmed de-energised and safe by the responsible authority.",
      "Raise the alarm, keep others clear, call emergency services and notify the Principal Contractor or Network Operator. Do not attempt electrical rescue outside training and authorisation.",
    ],
    stopWork: [
      "An exclusion or approach distance is or may be breached, asset voltage or location is uncertain, or zones are unclear, missing or unconfirmed.",
      "Unsafe plant movement, lost communication, vegetation contacting powerlines, lightning within 10 km, high wind, poor visibility or unsafe wet, humid or dusty conditions.",
    ],
  },
  {
    id: "traffic_corridor",
    documentCode: "EC-SWMS15",
    title: "Road, rail or other live traffic corridor",
    prompt: "Will ecological fieldwork, pre-clearing survey, observation or clearing supervision occur on, in or adjacent to a road, rail or other non-pedestrian traffic corridor?",
    limits: [
      "Ecology Consulting personnel do not perform traffic control, operate plant or interfere with traffic-management systems unless separately trained, authorised and engaged under the applicable controlled arrangement.",
      "Do not enter a live traffic or rail corridor unless the Principal Contractor's approved control arrangement is in place.",
    ],
    prerequisites: [
      "Confirm required approvals, Daily Toolbox Talk, current source SWMS/JSA, Traffic Management Plan and Traffic Guidance Scheme where applicable, traffic-control provider controls, designated work zone, buffers, safe parking and retreat arrangements.",
      "For rail, confirm written Rail Authority approval, valid rail induction, authorised access or possession, safe and danger zones, qualified lookout or rail safety controls, designated retreat areas and continuous rail-control communication.",
    ],
    controls: [
      "Avoid live corridors through remote observation, existing data, closures, rail possessions, designated safe areas or approved low-traffic periods wherever practicable.",
      "Remain in the designated work zone behind approved barriers, delineation and buffers. Use designated safe parking and access paths; face vehicles outward, do not reverse into or out of a live carriageway, and stop safely before recording data.",
      "Maintain communication with traffic control, plant operators and rail control. Keep clear of plant, use plant exclusion zones and controlled pedestrian paths, and approach plant only after operator acknowledgement.",
      "Use designated rail crossings only. Confirm the crossing is clear, pass one vehicle at a time, do not stop or queue on a level crossing, and use required spotter/rail arrangements.",
    ],
    crossReferences: [
      "Principal Contractor approved TMP/TGS and traffic-control provider; site Emergency Response Plan; EC-SWMS16 for plant exposure and EC-SWMS12 for overhead electrical exposure.",
    ],
    emergency: [
      "Move to the nominated retreat or muster point, notify the Field Lead and Principal Contractor, and maintain or restore traffic/rail-control communication before any restart.",
      "For a road or rail emergency, do not enter the path of traffic to assist unless the responsible traffic or rail authority confirms the area is controlled and safe.",
    ],
    stopWork: [
      "Traffic controls are missing, incorrect, damaged, ineffective or breached by vehicles or the public.",
      "Traffic, rail or plant communication is lost or unclear; a train warning or unauthorised movement occurs; plant breaches an exclusion zone; or visibility/lighting is unsafe.",
      "Fatigue or an environmental condition cannot be adequately controlled, or any worker feels unsafe.",
    ],
  },
  {
    id: "powered_mobile_plant",
    documentCode: "EC-SWMS16",
    title: "Powered mobile plant",
    prompt: "Will fieldwork, clearing supervision or ground-based fauna rescue occur where powered mobile plant is operating or may move?",
    limits: [
      "Ecology Consulting personnel are ecological observers only. They must not operate plant, excavate, cause ground disturbance or direct construction unless separately authorised under the applicable controlled arrangement.",
      "If people and plant cannot be adequately separated, work does not proceed.",
    ],
    prerequisites: [
      "Confirm the current source SWMS/JSA, Daily Toolbox Talk, planned plant activities and work zones, required permits and site plant/traffic inductions. Confirm the responsible operator is trained, licensed and authorised.",
      "Confirm Principal Contractor/site exclusion zones, barriers or engineering controls, controlled access points, pedestrian paths, traffic interfaces, plant-channel communications and spotter arrangements before entering a plant area.",
      "For potential underground services, review current BYDA/site information, verify services where possible, treat unknown services as live, do not excavate and stop/notify the Principal Contractor if services are at risk.",
    ],
    controls: [
      "Avoid plant work zones, defer the work or use remote observation where practicable. Park only in a designated safe area clear of plant routes, traffic, soft edges and excavations, with clear egress and site-supervisor awareness of vehicle location.",
      "Maintain marked exclusion zones and positive pedestrian–plant separation. Do not approach plant until acknowledged by the operator and stationary where required. Retain line of sight, stay out of blind spots, heed alarms and never walk behind operating plant.",
      "Where a spotter is required, the spotter must be competent, visible to the operator, outside travel paths and in continuous communication. The operator must stop immediately if visual contact is lost.",
      "Confirm daily vehicle and plant pre-use inspection, defect reporting and tag-out/no-use of unsafe equipment through the responsible operator or site supervisor. Report unsafe or unlicensed operation and withdraw to a safe location.",
      "For fauna rescue, confirm directly that all plant is stopped and isolated. Only trained and authorised staff handle fauna; the rescue is ground-based only, no climbing/elevated work, and an all-clear is confirmed before plant restarts. During clearing, remain at least one tree length from the felling tree, outside the drop zone with a clear escape path.",
    ],
    crossReferences: [
      "Select EC-SWMS15 where traffic or public interface exists and EC-SWMS12 where electrical or service exposure exists. Apply the Principal Contractor TMP/TGS and electrical/service controls where triggered.",
      "Site Emergency Response Plan; plant/traffic inductions; current service-location information; relevant clearing-supervision and fieldwork JSA/SOP controls.",
    ],
    emergency: [
      "For a person struck, trapped or crushed by plant, do not move the plant unless directed by the operator and it is safe. Stop and isolate nearby plant before responders approach.",
      "Make the area safe, do not move an injured person unless immediate danger requires it, account for the team, call 000 or 112 and provide GPS, nearest cross road and a safe responder access route.",
    ],
    stopWork: [
      "People and plant cannot be adequately separated, an exclusion zone is breached, plant operates outside a designated zone, an unknown hazard or service is identified, or unsafe/unlicensed operation is identified.",
      "Visibility is poor due to dust, weather or lighting, communication with operator or spotter is lost, spotter visual contact is lost, or traffic controls are inadequate.",
      "Plant has not been stopped and isolated before fauna rescue, or high wind, dust, smoke or rain makes clearing observation unsafe, or a worker feels unsafe.",
    ],
  },
  {
    id: "water_drowning",
    documentCode: "EC-SWMS18",
    title: "Water or drowning risk",
    prompt: "Will the survey or monitoring task be in or near a water body or other liquid with a risk of drowning, immersion, unstable footing, unexpected depth or water rescue?",
    limits: [
      "No diving. Do not enter unsafe water, water where rescue cannot immediately be performed, fast-flowing, flood-affected, poor-visibility, unknown-depth or unassessed water.",
      "No entry above waist depth unless the risk is specifically assessed and controlled. Waders are not flotation devices and must not be used in fast-flowing or deep water.",
    ],
    prerequisites: [
      "Assess depth, flow, bank stability, hidden hazards, substrate and safe entry/exit before work. Confirm weather, rainfall, upstream conditions, tide and releases, water-level monitoring, evacuation triggers and an accessible safe egress route.",
      "Confirm a two-person buddy system, one person on land when another is in water, continuous visual and verbal contact, stable access and the required PFD, gripped footwear, floating rescue rope of at least 20 m, reaching aid and waterproof/redundant communications.",
    ],
    controls: [
      "Avoid water entry using bank, bridge or elevated observation, cameras, binoculars, remote sensors, extendable tools or existing data wherever practicable.",
      "Establish safe setbacks around deep, fast-flowing, unstable, eroded, undercut or flood-prone water. Use stable infrastructure, designated crossings, platforms, handrails, barriers and access points where available; enter in a controlled manner with three points of stability.",
      "Do not carry heavy or awkward loads into water. Stage or pass equipment from the bank and test the substrate with a pole or stick before entry.",
      "Use reach-or-throw rescue from stable ground. Do not enter water for rescue unless trained and authorised. Carry dry clothing, monitor cold shock/hypothermia and use a waist belt with waders.",
    ],
    crossReferences: [
      "Site Emergency Response Plan, communications/check-in plan and EC-SWMS01 when a fall or unstable bank/edge risk also applies.",
    ],
    emergency: [
      "Get personnel out of the water or to a safe location, account for the team, call emergency services and provide the access/location information.",
      "Water rescue is reach-or-throw only unless a person is trained and authorised. Do not create a second casualty by entering uncontrolled water.",
    ],
    stopWork: [
      "Water level or flow rises; water is fast-flowing, flood affected or unstable; depth is unknown or unsafe; or banks/substrate are slippery, unstable, eroded, steep or undercut.",
      "Adverse weather, storms, rainfall increasing water risk or poor visibility occurs; safe egress cannot be maintained; or rescue cannot immediately be performed.",
      "Visual or verbal contact is lost, required rescue equipment or communications are absent or fail, or risks cannot be adequately controlled.",
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
      version: 2,
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
