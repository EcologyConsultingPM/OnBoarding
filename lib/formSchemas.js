// Auto-generated form schemas from the real EC standalone forms.
// Field tuple: [key, label, type]. type can be text|textarea|date|time|number|checkbox|signature|select:opt,opt
export const FORM_SCHEMAS = {
  "daily_risk_assessment": {
    "label": "Daily Risk Assessment",
    "group": "Field & mobilisation",
    "kind": "whs",
    "sections": [
      {
        "title": "Job details",
        "fields": [
          [
            "project",
            "Project",
            "text"
          ],
          [
            "client",
            "Client",
            "text"
          ],
          [
            "preparedBy",
            "Prepared by",
            "text"
          ],
          [
            "date",
            "Date",
            "date"
          ],
          [
            "startTime",
            "Start time",
            "time"
          ],
          [
            "crewLeader",
            "Crew leader",
            "text"
          ],
          [
            "jobNumber",
            "Project / job number",
            "text"
          ],
          [
            "site",
            "Site / plot",
            "text"
          ],
          [
            "nearestTown",
            "Nearest town",
            "text"
          ],
          [
            "workType",
            "Work type",
            "text"
          ],
          [
            "crewSize",
            "Crew size",
            "number"
          ],
          [
            "teamMembers",
            "All field staff and role / sign-off confirmation (one per line)",
            "textarea"
          ],
          [
            "expectedFinish",
            "Expected finish",
            "time"
          ]
        ]
      },
      {
        "title": "Conditions on arrival",
        "fields": [
          [
            "weather",
            "Weather summary",
            "text"
          ],
          [
            "rainfall",
            "Rainfall (mm)",
            "number"
          ],
          [
            "temperature",
            "Temperature (°C)",
            "number"
          ],
          [
            "windSpeed",
            "Wind speed (km/h)",
            "number"
          ],
          [
            "fireDanger",
            "Fire danger rating",
            "select:Low,Moderate,High,Very High,Severe,Extreme,Catastrophic"
          ],
          [
            "ground",
            "Ground conditions",
            "text"
          ],
          [
            "mobile",
            "Mobile coverage",
            "select:None,Patchy,Good"
          ],
          [
            "access",
            "Access",
            "text"
          ],
          [
            "hospitalDist",
            "Distance to nearest hospital",
            "text"
          ]
        ]
      },
      {
        "title": "WHS documents checked",
        "fields": [
          [
            "jsaReference",
            "JSA reference / version checked",
            "text"
          ],
          [
            "swmsReference",
            "SWMS reference / version checked",
            "text"
          ],
          [
            "sopReference",
            "SOP reference / version checked",
            "text"
          ],
          [
            "fieldPlanChecked",
            "Field plan and emergency response information reviewed",
            "checkbox"
          ]
        ]
      },
      {
        "title": "Hazards & emergency",
        "fields": [
          [
            "otherHazards",
            "Other hazards specific to today",
            "textarea"
          ],
          [
            "controlsConfirmed",
            "Controls confirmed or added today",
            "textarea"
          ],
          [
            "rvPoint",
            "Emergency rendezvous point",
            "text"
          ],
          [
            "hospital",
            "Nearest hospital / medical",
            "text"
          ],
          [
            "firstAidKit",
            "First aid kit location",
            "text"
          ],
          [
            "firstAider",
            "First aider on site",
            "text"
          ],
          [
            "plb",
            "PLB / satellite device ID",
            "text"
          ]
        ]
      },
      {
        "title": "Check-in",
        "fields": [
          [
            "checkInterval",
            "Check-in interval",
            "text"
          ],
          [
            "checkContact",
            "Check-in contact",
            "text"
          ],
          [
            "overdueTime",
            "Overdue escalation time",
            "text"
          ],
          [
            "decisions",
            "Decisions made / work stopped or modified today",
            "textarea"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "crewLeaderSig",
            "Crew leader signature",
            "signature"
          ],
          [
            "teamSignOff",
            "Team sign-off record (name, acknowledgement and time — one per line)",
            "textarea"
          ],
          [
            "signDate",
            "Date and time",
            "text"
          ]
        ]
      }
    ]
  },
  "journey_plan": {
    "label": "Journey Management Plan",
    "group": "Field & mobilisation",
    "kind": "whs",
    "sections": [
      {
        "title": "Journey details",
        "fields": [
          [
            "project",
            "Project",
            "text"
          ],
          [
            "client",
            "Client",
            "text"
          ],
          [
            "preparedBy",
            "Prepared by",
            "text"
          ],
          [
            "journeyRef",
            "Journey reference",
            "text"
          ],
          [
            "jobNumber",
            "Project / job number",
            "text"
          ],
          [
            "journeyType",
            "Journey type",
            "text"
          ],
          [
            "departDate",
            "Departure date",
            "date"
          ],
          [
            "departTime",
            "Departure time",
            "time"
          ],
          [
            "departingFrom",
            "Departing from",
            "text"
          ],
          [
            "returnDate",
            "Expected return date",
            "date"
          ],
          [
            "returnTime",
            "Expected return time",
            "time"
          ],
          [
            "drivingHours",
            "Total estimated driving hours",
            "text"
          ],
          [
            "loneWorker",
            "Lone worker?",
            "select:No,Yes"
          ],
          [
            "fatigue",
            "Fatigue management",
            "textarea"
          ]
        ]
      },
      {
        "title": "Vehicle",
        "fields": [
          [
            "vehicleReg",
            "Vehicle registration",
            "text"
          ],
          [
            "vehicleType",
            "Vehicle type",
            "text"
          ],
          [
            "fuelRange",
            "Fuel range / last fuel stop",
            "text"
          ]
        ]
      },
      {
        "title": "Monitoring & escalation",
        "fields": [
          [
            "monitor",
            "Journey monitor (office contact)",
            "text"
          ],
          [
            "monitorPhone",
            "Monitor phone",
            "text"
          ],
          [
            "backupMonitor",
            "Backup monitor",
            "text"
          ],
          [
            "checkFreq",
            "Check-in frequency",
            "text"
          ],
          [
            "finalCheckin",
            "Final check-in due",
            "text"
          ],
          [
            "overdueTrigger",
            "Overdue trigger (time)",
            "text"
          ],
          [
            "escalation",
            "Escalation instructions specific to this journey",
            "textarea"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "sig",
            "Signature",
            "signature"
          ],
          [
            "signDate",
            "Date and time",
            "text"
          ]
        ]
      }
    ]
  },
  "pre_mobilisation": {
    "label": "Pre-Mobilisation Checklist",
    "group": "Field & mobilisation",
    "kind": "whs",
    "sections": [
      {
        "title": "Details",
        "fields": [
          [
            "email",
            "Email",
            "text"
          ],
          [
            "project",
            "Project",
            "text"
          ],
          [
            "jobNumber",
            "Job number",
            "text"
          ],
          [
            "location",
            "Location",
            "text"
          ],
          [
            "date",
            "Date",
            "date"
          ],
          [
            "departTime",
            "Departure time",
            "time"
          ],
          [
            "expectedReturn",
            "Expected return",
            "text"
          ],
          [
            "completedBy",
            "Team member completing this form",
            "text"
          ],
          [
            "additionalStaff",
            "Additional field staff travelling",
            "textarea"
          ],
          [
            "commsOfficer",
            "Communication Officer",
            "text"
          ]
        ]
      },
      {
        "title": "Pre-travel checks",
        "fields": [
          ["vehicleConditionChecked", "Vehicle condition checked: fuel, fluids, tyres, lights, brakes and load secure", "checkbox"],
          ["emergencyEquipmentChecked", "Emergency equipment checked: first aid, extinguisher, recovery gear and compressor", "checkbox"],
          ["travelPreparationChecked", "Travel preparation checked: field plan, equipment, water, licence and roadworthiness", "checkbox"],
          ["environmentalChecksCompleted", "Weather, fire rating, traffic, lightning, air quality and journey plan checked", "checkbox"],
          ["preDepartureWeather", "Pre-departure weather conditions", "text"],
          ["fireRating", "Fire danger rating", "select:Low,Moderate,High,Very High,Severe,Extreme,Catastrophic"],
          ["airQuality", "Air quality rating", "text"]
        ]
      },
      {
        "title": "Vehicle",
        "fields": [
          [
            "vehicleReg",
            "Vehicle registration",
            "text"
          ],
          [
            "vehicleType",
            "Vehicle type",
            "text"
          ],
          [
            "odometer",
            "Odometer at departure",
            "text"
          ],
          [
            "weather",
            "Weather conditions",
            "text"
          ],
          [
            "comments",
            "Comments",
            "textarea"
          ]
        ]
      },
      {
        "title": "Outcome & approval",
        "fields": [
          [
            "failedItems",
            "Failed items and action taken",
            "textarea"
          ],
          [
            "fieldStaffNotified",
            "Associated field staff and Communication Officer notified",
            "checkbox"
          ],
          [
            "fitnessConfirmed",
            "Driver fitness and health confirmed for travel",
            "checkbox"
          ],
          [
            "officeNotified",
            "Office contact notified",
            "select:No,Yes"
          ],
          [
            "approval",
            "Office / supervisor approval to proceed",
            "select:Pending,Approved,Not approved"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "name",
            "Name",
            "text"
          ],
          [
            "position",
            "Position",
            "text"
          ],
          [
            "sig",
            "Signature",
            "signature"
          ],
          [
            "signDate",
            "Date and time",
            "text"
          ]
        ]
      }
    ]
  },
  "site_erp": {
    "label": "Site Specific ERP",
    "group": "Field & mobilisation",
    "kind": "whs",
    "sections": [
      {
        "title": "Site details",
        "fields": [
          [
            "project",
            "Project",
            "text"
          ],
          [
            "client",
            "Client",
            "text"
          ],
          [
            "preparedBy",
            "Prepared by",
            "text"
          ],
          [
            "jobNumber",
            "Project / job number",
            "text"
          ],
          [
            "siteName",
            "Site name",
            "text"
          ],
          [
            "datePrepared",
            "Date prepared",
            "date"
          ],
          [
            "siteAddress",
            "Site address and access description",
            "textarea"
          ],
          [
            "gps",
            "GPS coordinates of site access and muster point",
            "text"
          ],
          [
            "crossRoad",
            "Nearest cross-road / landmark",
            "text"
          ],
          [
            "what3words",
            "What3words or equivalent",
            "text"
          ],
          [
            "mobile",
            "Mobile coverage on site",
            "select:None,Patchy,Good"
          ],
          [
            "teamLead",
            "Project / team lead",
            "text"
          ],
          [
            "fieldTeam",
            "Field team members and first aid officer",
            "textarea"
          ],
          [
            "firstAidLocation",
            "First aid kit location",
            "text"
          ]
        ]
      },
      {
        "title": "Emergency contacts & communications",
        "fields": [
          ["emergencyContacts", "Emergency, utility, wildlife rescue and client / contractor contacts", "textarea"],
          ["communicationDevices", "Communication equipment available", "select:Mobile phone,UHF radio,InReach / satellite device,Ranger radio,Other"],
          ["checkinOne", "Check-in 1 time and contact", "text"],
          ["checkinTwo", "Check-in 2 time and contact", "text"],
          ["checkinThree", "Check-in 3 time and contact", "text"],
          ["checkinFour", "Check-in 4 time and contact", "text"]
        ]
      },
      {
        "title": "Medical & evacuation",
        "fields": [
          [
            "hospitalName",
            "Nearest hospital - name",
            "text"
          ],
          [
            "hospitalAddress",
            "Hospital address",
            "text"
          ],
          [
            "travelTime",
            "Travel time from site",
            "text"
          ],
          [
            "medCentre",
            "Nearest medical centre",
            "text"
          ],
          [
            "airAmbulance",
            "Air ambulance landing area",
            "text"
          ],
          [
            "ambulanceRV",
            "Vehicle RV point for ambulance",
            "text"
          ]
        ]
      },
      {
        "title": "Muster & response",
        "fields": [
          [
            "muster1",
            "Primary muster point",
            "text"
          ],
          [
            "muster2",
            "Secondary muster point",
            "text"
          ],
          [
            "evacRoute",
            "Evacuation route from site",
            "textarea"
          ],
          [
            "headCount",
            "Head count responsibility",
            "text"
          ],
          [
            "siren",
            "Site siren / call sign",
            "text"
          ],
          [
            "assemblyReport",
            "Assembly reporting to",
            "text"
          ],
          [
            "scenarios",
            "Additional site-specific scenarios",
            "textarea"
          ],
          [
            "hazards",
            "Site-specific hazards this plan responds to",
            "textarea"
          ],
          [
            "resources",
            "Emergency resources available on site",
            "textarea"
          ],
          [
            "meetingLocationEvidence",
            "Staff meeting location photo / file reference",
            "text"
          ],
          [
            "hospitalRouteEvidence",
            "Hospital route screenshot / file reference",
            "text"
          ],
          [
            "dailyCheckinAcknowledged",
            "Remote / isolated work status and daily check-in procedure acknowledged",
            "checkbox"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "draftedBySig",
            "Drafted by signature",
            "signature"
          ],
          [
            "approvedBy",
            "Approved by",
            "text"
          ],
          [
            "approvedBySig",
            "Approved by signature",
            "signature"
          ],
          [
            "signDate",
            "Date",
            "text"
          ]
        ]
      }
    ]
  },
  "leave": {
    "label": "Leave Request",
    "group": "Staff & HR",
    "kind": "request",
    "sections": [
      {
        "title": "Leave details",
        "fields": [
          [
            "employeeName",
            "Employee Name",
            "text"
          ],
          [
            "department",
            "Department",
            "text"
          ],
          [
            "leaveType",
            "Leave Type",
            "select:Annual,Personal / carer's,Compassionate,Long service,Unpaid,Other"
          ],
          [
            "startDate",
            "Start Date",
            "date"
          ],
          [
            "endDate",
            "End Date",
            "date"
          ],
          [
            "totalDays",
            "Total Days",
            "number"
          ],
          [
            "reason",
            "Reason (if required)",
            "textarea"
          ],
          [
            "cover",
            "Who Will Cover This Role",
            "text"
          ],
          [
            "higherDuties",
            "Higher Duties Form Required?",
            "select:No,Yes"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "name",
            "Name",
            "text"
          ],
          [
            "sig",
            "Signature",
            "signature"
          ],
          [
            "date",
            "Date",
            "date"
          ]
        ]
      }
    ]
  },
  "training": {
    "label": "Training Request",
    "group": "Staff & HR",
    "kind": "request",
    "sections": [
      {
        "title": "Requester",
        "fields": [
          [
            "email",
            "Email",
            "text"
          ],
          [
            "name",
            "Name",
            "text"
          ],
          [
            "position",
            "Position",
            "text"
          ],
          [
            "dateOfRequest",
            "Date of request",
            "date"
          ],
          [
            "supervisor",
            "Supervisor",
            "text"
          ],
          [
            "careerLevel",
            "Career level",
            "select:Basics,Early Career,Mid Level,Senior Level"
          ]
        ]
      },
      {
        "title": "Course",
        "fields": [
          [
            "course",
            "Course / accreditation title",
            "text"
          ],
          [
            "provider",
            "Training provider",
            "text"
          ],
          [
            "trainingType",
            "Training type",
            "text"
          ],
          [
            "deliveryMode",
            "Delivery mode",
            "select:In person,Online,Blended"
          ],
          [
            "duration",
            "Duration",
            "text"
          ],
          [
            "startDate",
            "Preferred start date",
            "date"
          ],
          [
            "location",
            "Location",
            "text"
          ],
          [
            "closingDate",
            "Registration closing date",
            "date"
          ],
          [
            "outline",
            "Course outline / link",
            "text"
          ]
        ]
      },
      {
        "title": "Justification",
        "fields": [
          [
            "why",
            "Why this training, and why now",
            "textarea"
          ],
          [
            "howApplied",
            "How it will be applied",
            "textarea"
          ],
          [
            "competency",
            "Links to a competency requirement?",
            "text"
          ],
          [
            "project",
            "Related project or client",
            "text"
          ],
          [
            "funding",
            "External funding or subsidy available?",
            "select:No,Yes"
          ],
          [
            "fundingDetail",
            "Funding detail",
            "text"
          ]
        ]
      },
      {
        "title": "Impact",
        "fields": [
          [
            "datesAway",
            "Dates away from work",
            "text"
          ],
          [
            "fieldDays",
            "Field days affected",
            "text"
          ],
          [
            "cover",
            "Cover arrangements",
            "textarea"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "requesterName",
            "Requester name",
            "text"
          ],
          [
            "sig",
            "Requester signature",
            "signature"
          ]
        ]
      }
    ]
  },
  "equipment": {
    "label": "Equipment Request",
    "group": "Staff & HR",
    "kind": "request",
    "sections": [
      {
        "title": "Requester",
        "fields": [
          [
            "email",
            "Email",
            "text"
          ],
          [
            "name",
            "Name",
            "text"
          ],
          [
            "position",
            "Position",
            "text"
          ],
          [
            "dateOfRequest",
            "Date of request",
            "date"
          ],
          [
            "jobNumber",
            "Project / job number",
            "text"
          ],
          [
            "client",
            "Client",
            "text"
          ],
          [
            "requiredBy",
            "Required by date",
            "date"
          ],
          [
            "urgency",
            "Urgency",
            "select:Routine,Priority,Urgent"
          ],
          [
            "mobDate",
            "Mobilisation date",
            "date"
          ]
        ]
      },
      {
        "title": "Equipment",
        "fields": [
          [
            "category",
            "Primary category",
            "text"
          ],
          [
            "cost",
            "Total estimated cost",
            "text"
          ],
          [
            "budgetSource",
            "Budget source",
            "text"
          ],
          [
            "purpose",
            "What the equipment is for",
            "textarea"
          ],
          [
            "checkedStock",
            "Checked existing stock?",
            "select:No,Yes"
          ],
          [
            "hireConsidered",
            "Hire considered?",
            "select:No,Yes"
          ],
          [
            "replacing",
            "If replacing an existing item - what happened to it",
            "textarea"
          ]
        ]
      },
      {
        "title": "PPE & compliance",
        "fields": [
          [
            "includesPPE",
            "Includes PPE?",
            "select:No,Yes"
          ],
          [
            "sizes",
            "Sizes required",
            "text"
          ],
          [
            "ausStandard",
            "Australian Standard required",
            "text"
          ],
          [
            "ppeNotes",
            "PPE notes",
            "textarea"
          ],
          [
            "calibration",
            "Calibration required?",
            "select:No,Yes"
          ],
          [
            "licence",
            "Licence or permit required?",
            "select:No,Yes"
          ],
          [
            "training",
            "Training required before use?",
            "select:No,Yes"
          ],
          [
            "whoTrained",
            "Who will be trained and when",
            "text"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "requesterName",
            "Requester name",
            "text"
          ],
          [
            "sig",
            "Requester signature",
            "signature"
          ]
        ]
      }
    ]
  },
  "injury_incident": {
    "label": "Incident Report",
    "group": "WHS & office",
    "kind": "whs",
    "sections": [
      {
        "title": "Incident details",
        "fields": [
          [
            "date",
            "Date of incident",
            "date"
          ],
          [
            "time",
            "Time",
            "time"
          ],
          [
            "location",
            "Location / site",
            "text"
          ],
          [
            "reportedBy",
            "Reported by",
            "text"
          ],
          [
            "incidentType",
            "Incident type",
            "select:Injury,Illness,Near miss,Dangerous incident,Property/environment,Other"
          ],
          [
            "severity",
            "Severity rating",
            "select:Minor,Moderate,Serious,Critical"
          ],
          [
            "description",
            "What happened (sequence of events)",
            "textarea"
          ],
          [
            "injuryNature",
            "Nature of injury/illness",
            "text"
          ],
          [
            "bodyPart",
            "Body part(s) affected",
            "text"
          ],
          [
            "treatment",
            "Medical treatment given",
            "textarea"
          ],
          [
            "witness",
            "Witnesses (name & contact)",
            "textarea"
          ],
          [
            "cause",
            "Immediate & contributing causes",
            "textarea"
          ],
          [
            "controls",
            "Immediate controls put in place",
            "textarea"
          ]
        ]
      },
      {
        "title": "Notifiable check",
        "fields": [
          [
            "notifiable_flag",
            "This may meet the threshold for a notifiable incident (flag for admin)",
            "checkbox"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "reporterSig",
            "Reporter signature",
            "signature"
          ],
          [
            "signDate",
            "Date",
            "date"
          ]
        ]
      }
    ]
  },
  "office_risk_assessment": {
    "label": "Office Risk Assessment",
    "group": "WHS & office",
    "kind": "whs",
    "sections": [
      {
        "title": "Details",
        "fields": [
          [
            "area",
            "Area / office assessed",
            "text"
          ],
          [
            "assessedBy",
            "Assessed by",
            "text"
          ],
          [
            "date",
            "Date",
            "date"
          ]
        ]
      },
      {
        "title": "Inspection",
        "fields": [
          [
            "findings",
            "Inspection findings (walkways, electrical, ergonomics, emergency, amenities)",
            "textarea"
          ],
          [
            "hazards",
            "Hazards identified",
            "textarea"
          ],
          [
            "risk",
            "Risk rating",
            "select:Low,Medium,High"
          ],
          [
            "actions",
            "Actions required",
            "textarea"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "sig",
            "Signature",
            "signature"
          ],
          [
            "date2",
            "Date",
            "date"
          ]
        ]
      }
    ]
  },
  "job_safety_analysis": {
    "label": "Job Safety Analysis",
    "group": "WHS & office",
    "kind": "whs",
    "sections": [
      {
        "title": "JSA details",
        "fields": [
          [
            "task",
            "Task / activity",
            "text"
          ],
          [
            "location",
            "Location",
            "text"
          ],
          [
            "preparedBy",
            "Prepared by",
            "text"
          ],
          [
            "date",
            "Date",
            "date"
          ]
        ]
      },
      {
        "title": "Analysis",
        "fields": [
          [
            "steps",
            "Work steps, hazards & controls (one per line: step - hazard - control)",
            "textarea"
          ],
          [
            "hoc",
            "Hierarchy of control applied (Elim/Sub/Eng/Admin/PPE)",
            "textarea"
          ],
          [
            "residualRisk",
            "Overall residual risk",
            "select:Low,Medium,High"
          ]
        ]
      },
      {
        "title": "Crew sign-on",
        "fields": [
          [
            "crew",
            "Crew names & roles (one per line)",
            "textarea"
          ],
          [
            "sig",
            "Prepared-by signature",
            "signature"
          ]
        ]
      }
    ]
  },
  "first_aid_kit": {
    "label": "First Aid Kit Checks",
    "group": "WHS & office",
    "kind": "whs",
    "sections": [
      {
        "title": "Check details",
        "fields": [
          [
            "email",
            "Email",
            "text"
          ],
          [
            "date",
            "Date of check",
            "date"
          ],
          [
            "checkedBy",
            "Checked by",
            "text"
          ],
          [
            "position",
            "Position",
            "text"
          ],
          [
            "checkType",
            "Check type",
            "select:Routine,Post-use,Restock"
          ],
          [
            "kitType",
            "Kit type",
            "select:Family Soft Pack,Snake Bite Kit,Modulator Kit,Other"
          ],
          [
            "kitNumber",
            "Kit number / asset identifier",
            "text"
          ],
          [
            "nextDue",
            "Next check due",
            "date"
          ]
        ]
      },
      {
        "title": "Kits",
        "fields": [
          [
            "kitA",
            "Vehicle registration (Kit A)",
            "text"
          ],
          [
            "kitB",
            "Field pack ID (Kit B)",
            "text"
          ],
          [
            "kitC",
            "Office location (Kit C)",
            "text"
          ],
          [
            "sealIntact",
            "Kit seal intact on inspection",
            "select:Yes,No"
          ],
          [
            "kitAOutcome",
            "Kit A outcome",
            "select:Pass,Restocked,Fail"
          ],
          [
            "kitBOutcome",
            "Kit B outcome",
            "select:Pass,Restocked,Fail"
          ],
          [
            "kitCOutcome",
            "Kit C outcome",
            "select:Pass,Restocked,Fail"
          ],
          [
            "aedPad",
            "AED pad expiry",
            "date"
          ],
          [
            "aedBattery",
            "AED battery expiry",
            "date"
          ],
          [
            "kitInventory",
            "Inventory results (item, quantity available, batch number and expiry — one per line)",
            "textarea"
          ],
          [
            "restockRequired",
            "Replenishment / replacement required",
            "select:No,Yes - replenish stock,Yes - replace expired item,Yes - remove kit from service"
          ],
          [
            "notes",
            "Notes - recent first aid use, incidents linked to these kits",
            "textarea"
          ]
        ]
      },
      {
        "title": "Sign-off",
        "fields": [
          [
            "checkedByName",
            "Checked by - name",
            "text"
          ],
          [
            "sig",
            "Signature",
            "signature"
          ],
          [
            "verifiedBy",
            "Verified by (WHS / Manager)",
            "text"
          ]
        ]
      }
    ]
  }
};

export const FORM_GROUPS = ['Staff & HR', 'Field & mobilisation', 'WHS & office'];
