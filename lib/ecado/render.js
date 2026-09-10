/**
 * Ecado — deterministic renderers.
 *
 * These produce the approved output formats directly from the rule
 * engine, with no model involved. The console works fully with narration
 * disabled; the LLM only adds an executive summary paragraph on top of
 * this. If the model is unavailable, the brief is still correct and still
 * ships.
 */

import { RATING_ICON, countByRating } from "./types";
import { formatAuDate } from "./thresholds";

const AU_DATE = (d) => d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney" });
const AU_TIME = (iso) => (iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short", timeZone: "Australia/Sydney" }) : "unknown");

function block(f) {
  return [
    `**${RATING_ICON[f.rating]} ${f.title}**`,
    `- What happened: ${f.whatHappened}`,
    `- Why it matters: ${f.whyItMatters}`,
    `- What next: ${f.whatNext}`,
    f.owner ? `- Owner: ${f.owner}` : "- Owner: **unassigned — assign today**",
    `- Source: ${f.sourceType} \`${f.sourceId}\``,
  ].join("\n");
}

function section(title, findings, emptyText) {
  if (!findings.length) return `### ${title}\n\n${emptyText}\n`;
  return `### ${title}\n\n${findings.map(block).join("\n\n")}\n`;
}

function byRating(findings, rating) {
  return findings.filter((f) => f.rating === rating);
}

function decisionsRequired(findings) {
  const decisions = findings.filter((f) => f.level >= 3).map((f, i) => `${i + 1}. **${f.title}** — ${f.whatNext} *(deferring this: ${consequence(f)})*`);
  return decisions.length ? decisions.join("\n") : "No decisions require your authority. Items below sit with their named owners.";
}

function consequence(f) {
  switch (f.domain) {
    case "safety": return "hazard stays uncontrolled and the record shows it was known";
    case "compliance": return "the obligation continues to age and the audit finding hardens";
    case "client": return "the client discovers the slippage before we disclose it";
    case "delivery": return "recovery options reduce each day";
    case "wellbeing": return "the load stays on the same person another week";
    case "commercial": return "unrecoverable cost continues to accrue";
    default: return "the issue compounds";
  }
}

function dataConfidence(snapshot) {
  const lines = [];
  for (const [feed, ts] of Object.entries(snapshot.dataCurrentTo)) lines.push(`- ${feed}: ${AU_TIME(ts)}`);
  const gapLines = snapshot.gaps.map((g) => `- \u26a0 ${g.detail}`);
  return [
    "### Data confidence",
    "",
    "Data current to:",
    ...lines,
    ...(gapLines.length ? ["", "Gaps affecting this brief:", ...gapLines] : ["", "No feed gaps detected."]),
  ].join("\n");
}

function nextReview(kind, now) {
  const d = new Date(now);
  if (kind === "daily") d.setDate(d.getDate() + 1);
  else if (kind === "weekly" || kind === "program") d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + 14);
  return `**Next review:** ${AU_DATE(d)}`;
}

function staleSection(stale) {
  if (!stale.length) return "";
  const rows = stale.map((e) => `- ${RATING_ICON[e.peak_rating]} **${e.title}** — opened ${formatAuDate(e.opened_at)}, last seen ${formatAuDate(e.last_seen_at)}. No longer detected in the data but not closed by anyone.`);
  return ["### Open escalations no longer detected", "", "These stopped appearing in the source data without a recorded closure. Confirm each was genuinely resolved rather than edited away, then close it with a reason.", "", ...rows, ""].join("\n");
}

export function renderDaily(findings, snapshot, stale, now = new Date()) {
  const c = countByRating(findings);
  return [
    "# ECADO DAILY OPERATIONS BRIEF",
    "",
    `**${AU_DATE(now)}**`,
    "",
    "## Executive summary",
    "",
    `${c.critical} critical, ${c.high} high, ${c.medium} medium items. ${c.critical ? "Critical items require action today." : "Nothing critical outstanding."}`,
    "",
    section("\ud83d\udd34 Critical", byRating(findings, "critical"), "Nothing critical."),
    section("\ud83d\udfe0 High", byRating(findings, "high"), "Nothing at high priority."),
    section("\ud83d\udfe1 Upcoming", byRating(findings, "medium"), "Nothing due in the medium window."),
    staleSection(stale),
    "### Decisions required from you",
    "",
    decisionsRequired(findings),
    "",
    "### Recommended immediate actions",
    "",
    recommendedActions(findings),
    "",
    dataConfidence(snapshot),
    "",
    nextReview("daily", now),
  ].join("\n");
}

export function renderWeekly(findings, snapshot, stale, now = new Date()) {
  const c = countByRating(findings);
  const projects = findings.filter((f) => ["project", "deliverable", "activity"].includes(f.sourceType));
  const compliance = findings.filter((f) => f.domain === "safety" || f.domain === "compliance");
  const capacity = findings.filter((f) => f.domain === "capacity" || f.domain === "wellbeing");
  const commercial = findings.filter((f) => f.domain === "commercial");

  return [
    "# PROGRAM & PROJECT MANAGEMENT BRIEF",
    "",
    `**Week ending ${AU_DATE(now)}**`,
    "",
    "## Executive summary",
    "",
    `${c.critical} critical, ${c.high} high, ${c.medium} medium across the portfolio.`,
    "",
    "## Portfolio health",
    "",
    portfolioTable(findings, snapshot),
    "",
    section("Projects requiring attention", projects.filter((f) => f.level >= 3), "No project requires management attention this week."),
    section("Compliance status", compliance, "No outstanding compliance or safety findings."),
    section("Resource status", capacity, "No capacity exceptions."),
    section("Commercial position", commercial, "No commercial exceptions."),
    staleSection(stale),
    "### Executive decisions required",
    "",
    decisionsRequired(findings),
    "",
    "### Recommended immediate actions",
    "",
    recommendedActions(findings),
    "",
    dataConfidence(snapshot),
    "",
    nextReview("weekly", now),
  ].join("\n");
}

const RATING_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function portfolioTable(findings, snapshot) {
  const projects = snapshot.feeds.projects?.rows ?? [];
  if (!projects.length) return "Project feed unavailable — portfolio health cannot be assessed.";

  const worst = new Map();
  for (const f of findings) {
    if (f.sourceType !== "project") continue;
    const cur = worst.get(f.sourceId);
    if (!cur || RATING_RANK[f.rating] < RATING_RANK[cur]) worst.set(f.sourceId, f.rating);
  }

  const critical = [...worst.values()].filter((r) => r === "critical").length;
  const high = [...worst.values()].filter((r) => r === "high").length;
  const clean = projects.length - worst.size;

  return [`| Active | On track | Require review | Critical |`, `|---|---|---|---|`, `| ${projects.length} | ${clean} | ${high} | ${critical} |`].join("\n");
}

export function renderProject(projectRef, findings, snapshot, now = new Date()) {
  const overall = findings.length ? findings.reduce((acc, f) => (RATING_RANK[f.rating] < RATING_RANK[acc] ? f.rating : acc), "low") : "low";

  const domains = [
    ["Schedule", findings.filter((f) => f.ruleId.startsWith("deliverable") || f.ruleId.startsWith("survey") || f.ruleId.startsWith("activity"))],
    ["Budget", findings.filter((f) => f.ruleId.startsWith("budget") || f.ruleId.startsWith("variation"))],
    ["Resources", findings.filter((f) => f.domain === "capacity" || f.domain === "wellbeing")],
    ["Compliance", findings.filter((f) => f.domain === "compliance" || f.domain === "safety")],
  ];

  return [
    `# PROJECT HEALTH REVIEW — ${projectRef}`,
    "",
    `**${AU_DATE(now)}**`,
    "",
    `**Overall health: ${RATING_ICON[overall]} ${overall.toUpperCase()}**`,
    "",
    "## Status by domain",
    "",
    ...domains.map(([name, fs]) => {
      const r = fs.length ? fs.reduce((acc, f) => (RATING_RANK[f.rating] < RATING_RANK[acc] ? f.rating : acc), "low") : "low";
      return `- **${name}** ${RATING_ICON[r]} — ${fs.length ? `${fs.length} finding(s)` : "no exceptions detected"}`;
    }),
    "",
    section("Findings", findings, "No findings for this project. Note that this reflects the data available, not an assurance that the project is healthy."),
    "### Required decisions",
    "",
    decisionsRequired(findings),
    "",
    "### Recommended actions",
    "",
    recommendedActions(findings),
    "",
    dataConfidence(snapshot),
    "",
    nextReview("project", now),
  ].join("\n");
}

export function renderCapacity(findings, snapshot, now = new Date()) {
  const over = findings.filter((f) => f.ruleId === "allocation.over");
  const under = findings.filter((f) => f.ruleId === "allocation.under");
  return [
    "# STAFF CAPACITY REVIEW",
    "",
    `**${AU_DATE(now)}** — three week horizon`,
    "",
    section("Overallocated", over, "No staff over the allocation threshold."),
    section("Available capacity", under, "No spare capacity identified."),
    "### Recommended reallocations",
    "",
    reallocationSuggestions(over, under),
    "",
    dataConfidence(snapshot),
    "",
    nextReview("capacity", now),
  ].join("\n");
}

function reallocationSuggestions(over, under) {
  if (!over.length) return "No reallocation required.";
  if (!under.length) return "No spare internal capacity to absorb the overload. The options are: move a deliverable date, engage a subcontractor, or reduce scope. This is a decision, not a scheduling exercise.";
  return over.map((o) => {
    const candidates = under.slice(0, 2).map((u) => u.owner).filter(Boolean).join(" or ");
    return `- Move review or GIS work from **${o.owner}** to **${candidates}**. Confirm competency before reallocating fieldwork.`;
  }).join("\n");
}

export function renderCompliance(findings, snapshot, now = new Date()) {
  const grouped = [
    ["WHS", ["whs.notifiable_open", "whs.investigation_overdue"]],
    ["Corrective actions", ["corrective_action.overdue"]],
    ["Training and certification", ["certification.expiring"]],
    ["Regulatory", ["regulatory.unassessed"]],
    ["Data gaps", ["data.gap.missing_table", "data.gap.missing_columns", "data.gap.query_error", "data.gap.stale"]],
  ];

  return [
    "# COMPLIANCE REVIEW",
    "",
    `**${AU_DATE(now)}**`,
    "",
    ...grouped.map(([name, ruleIds]) => section(name, findings.filter((f) => ruleIds.includes(f.ruleId)), "No findings.")),
    "### Required actions",
    "",
    recommendedActions(findings),
    "",
    dataConfidence(snapshot),
    "",
    nextReview("compliance", now),
  ].join("\n");
}

export function recommendedActions(findings) {
  const top = findings.filter((f) => f.level >= 3).slice(0, 7);
  if (!top.length) return "No immediate actions. Continue monitoring.";
  return top.map((f, i) => `${i + 1}. ${f.whatNext} *(${f.sourceRef ?? f.sourceId} — ${f.owner ?? "owner to be assigned"})*`).join("\n");
}

export function render(kind, findings, snapshot, stale, subjectRef = null, now = new Date()) {
  switch (kind) {
    case "daily": return renderDaily(findings, snapshot, stale, now);
    case "weekly":
    case "program": return renderWeekly(findings, snapshot, stale, now);
    case "project": return renderProject(subjectRef ?? "unknown project", findings, snapshot, now);
    case "capacity": return renderCapacity(findings, snapshot, now);
    case "compliance": return renderCompliance(findings, snapshot, now);
    default: return renderDaily(findings, snapshot, stale, now);
  }
}
