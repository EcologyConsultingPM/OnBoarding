export const LEARNING_LEVELS = [
  { value: "foundation", label: "Level 1 · Foundation" },
  { value: "working", label: "Level 2 · Working with supervision" },
  { value: "independent", label: "Level 3 · Independent within scope" },
  { value: "advanced", label: "Level 4 · Advanced / reviewer" },
];

export const LEARNING_CYCLE = [
  { key: "learn", label: "Learn" },
  { key: "practise", label: "Practise" },
  { key: "demonstrate", label: "Demonstrate" },
  { key: "review", label: "Review" },
  { key: "authorise", label: "Authorise" },
];

const TEXT_FIELDS = [
  "why",
  "what",
  "when",
  "good_practice",
  "common_errors",
  "decision_scope",
  "escalation",
  "assessment",
  "competency_statement",
  "scope",
  "supervision",
];

const LIST_FIELDS = ["how", "evidence", "references"];

const cleanText = (value, maximum = 8000) => String(value || "").trim().slice(0, maximum);
const cleanList = (value, maximum = 30) => {
  const input = Array.isArray(value) ? value : String(value || "").split("\n");
  return input
    .map((item) => cleanText(item, 1000))
    .filter(Boolean)
    .slice(0, maximum);
};

export function createDefaultModuleContent() {
  return {
    learning_level: "foundation",
    scope: "",
    supervision: "",
    why: "",
    what: "",
    when: "",
    how: [],
    good_practice: "",
    common_errors: "",
    evidence: [],
    decision_scope: "",
    escalation: "",
    assessment: "",
    competency_statement: "",
    references: [],
  };
}

export function normaliseModuleContent(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const content = createDefaultModuleContent();
  const allowedLevels = new Set(LEARNING_LEVELS.map((level) => level.value));
  content.learning_level = allowedLevels.has(source.learning_level)
    ? source.learning_level
    : content.learning_level;
  for (const field of TEXT_FIELDS) content[field] = cleanText(source[field]);
  for (const field of LIST_FIELDS) content[field] = cleanList(source[field]);
  return content;
}

export function getModuleReadiness(value) {
  const content = normaliseModuleContent(value);
  const missing = [];
  const required = [
    ["why", "Why this matters"],
    ["what", "What it is"],
    ["when", "When to use it"],
    ["good_practice", "What good looks like"],
    ["common_errors", "Common errors"],
    ["decision_scope", "Decision boundaries"],
    ["escalation", "Escalation triggers"],
    ["assessment", "Application-based assessment"],
    ["competency_statement", "Competency statement"],
    ["scope", "Authorised scope"],
    ["supervision", "Supervision requirement"],
  ];
  for (const [key, label] of required) if (!content[key]) missing.push(label);
  if (content.how.length < 3) missing.push("At least three practical steps");
  if (!content.evidence.length) missing.push("Evidence to retain");
  return { content, missing, ready: missing.length === 0 };
}
