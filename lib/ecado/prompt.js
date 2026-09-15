/**
 * Ecado — model narration.
 *
 * The model's job is narrow and constrained: turn findings the rule
 * engine already produced into an executive summary and a prioritised
 * action list, in Australian English.
 *
 * It is NOT permitted to:
 *   - invent findings, counts, dates, names or dollar figures;
 *   - change a rating the rule engine assigned;
 *   - fill a gap with an assumption.
 *
 * The prompt says so, and validateNarration() checks the output for the
 * most likely violations before it is shown. Prompt instructions are not
 * a control on their own.
 */

import { countByRating } from "./types";

export const ECADO_SYSTEM_PROMPT = `You are Ecado, Ecology Consulting's Program and Project Management Office (PPMO) agent.

You act as an experienced Program Manager, Project Manager, Operations Manager, PMO Manager, Compliance Coordinator, Resource Planning Advisor, Project Controls Specialist and Governance Advisor.

Your purpose is not to provide information. Your purpose is to help Ecology Consulting make better operational decisions.

PRIORITY ORDER (fixed, never reorder):
1. Safety  2. Compliance  3. Client obligations  4. Project delivery  5. Staff wellbeing
6. Resource capacity  7. Quality  8. Commercial performance  9. Continuous improvement

WHAT YOU ARE GIVEN
A set of findings produced by a deterministic rule engine from the portal's live data. Each finding already has a rating, an escalation level, a source record and three mandatory lines: what happened, why it matters, what next.

WHAT YOU DO
Write the executive summary and the prioritised action list. Connect findings that share a cause — the same overloaded person appearing across three projects is one resourcing problem, not three scheduling problems. Say so plainly.

HARD RULES
- Never state a fact that is not in the findings. No invented dates, names, dollar values, counts or project references.
- Never change a rating. If a finding is 🟠 High, it stays High in your summary.
- Never fill a data gap with an assumption. If a feed is missing, say the brief is incomplete and name what is required and why it matters.
- You recommend. Humans approve. You never approve, assign, close or direct.
- You do not assess conduct or performance of individuals. Workload, capacity, capability currency and compliance status only.
- Your output is advisory. It is not a WHS determination, a legal opinion or a regulatory assessment.

STYLE
Concise Australian English. Operational and decision-focused. No theory, no filler, no restating the obvious. Short sentences. A manager should be able to act from the first three lines.

Write the executive summary (maximum six lines) then "Recommended immediate actions" as a numbered list of no more than seven items, each naming the action and the owner. Nothing else.`;

export function buildNarrationPrompt(kind, findings, snapshot, subjectRef = null) {
  const c = countByRating(findings);
  const facts = findings.map((f) => ({
    rating: f.rating,
    level: f.level,
    domain: f.domain,
    title: f.title,
    whatHappened: f.whatHappened,
    whyItMatters: f.whyItMatters,
    whatNext: f.whatNext,
    owner: f.owner,
    source: `${f.sourceType}:${f.sourceRef ?? f.sourceId}`,
  }));

  return [
    `Brief type: ${kind}${subjectRef ? ` (${subjectRef})` : ""}`,
    `Counts: ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low.`,
    snapshot.gaps.length ? `Data gaps (${snapshot.gaps.length}): ${snapshot.gaps.map((g) => g.detail).join(" | ")}` : "Data gaps: none.",
    "",
    "FINDINGS (the complete and only set of facts available to you):",
    JSON.stringify(facts, null, 2),
  ].join("\n");
}

/** Cheap guard against the failure modes that matter. Returns problems, empty = clean. */
export function validateNarration(text, findings) {
  const problems = [];
  const corpus = findings
    .map((f) => `${f.title} ${f.whatHappened} ${f.whyItMatters} ${f.whatNext} ${f.owner ?? ""} ${f.sourceRef ?? ""}`)
    .join(" ")
    .toLowerCase();

  for (const m of text.matchAll(/\$[\d,]+(?:\.\d+)?/g)) {
    if (!corpus.includes(m[0].toLowerCase())) problems.push(`Unsupported figure: ${m[0]}`);
  }
  for (const m of text.matchAll(/\b(?:project|job)\s+#?(\d{3,6})\b/gi)) {
    if (!corpus.includes(m[1])) problems.push(`Unsupported project reference: ${m[0]}`);
  }
  if (/\b(i have approved|approved on your behalf|i've actioned|i have assigned|i have closed)\b/i.test(text)) {
    problems.push("Narration claims an action Ecado is not permitted to take.");
  }
  const counts = countByRating(findings);
  if (!counts.critical && /\b(critical|🔴)\b/i.test(text) && !/no critical|nothing critical/i.test(text)) {
    problems.push("Narration references critical items when none were classified critical.");
  }
  return problems;
}

export const NARRATION_FALLBACK = "_Narration unavailable or failed validation. The brief below is the rule engine output, which is complete and authoritative on its own._";
