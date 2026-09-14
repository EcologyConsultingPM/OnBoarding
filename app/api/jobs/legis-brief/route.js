import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function jobAuthorised(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(secret) && supplied === `Bearer ${secret}`;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Legis requires Supabase server credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function loadSourcePack() {
  const root = path.join(process.cwd(), "config", "legis");
  const read = (name) => {
    const file = path.join(root, name);
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (!value) throw new Error("file is empty");
      return value;
    } catch (error) {
      throw new Error(`Legis source-pack file missing or unreadable: ${file} (${error.message})`);
    }
  };
  return {
    sources: read("sources.yaml"),
    triage: read("triage.yaml"),
    activeLgas: read("active-lgas.txt"),
    template: read("weekly-brief-template.md"),
    workedExample: read("EXAMPLE_worked-example-brief.md"),
  };
}

async function loadActiveProjectRoster(admin) {
  const { data: projects } = await admin.from("projects").select("id, name, client_name, project_lead_user_id, status").eq("status", "active").limit(200);
  if (!projects?.length) return [];
  const leadIds = [...new Set(projects.map((p) => p.project_lead_user_id).filter(Boolean))];
  let leadEmailById = new Map();
  if (leadIds.length) {
    const { data: usersData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    leadEmailById = new Map((usersData?.users || []).map((u) => [u.id, u.email]));
  }
  return projects.map((p) => ({ name: p.name, client: p.client_name || null, lead: p.project_lead_user_id ? leadEmailById.get(p.project_lead_user_id) || null : null }));
}

// Legis has three formal responsibilities, specified exactly and adopted
// verbatim rather than paraphrased: Regulatory Research, the Regulatory
// Watchlist (with its precise required fields), and the LLC Recommendation
// (the four-option action classification with mandatory reasoning). This
// replaces an earlier, self-invented four-tier classification — the
// business's own framework is what ships, not a variant of it.
const SYSTEM_PROMPT = `You are Legis, producing an in-depth weekly NSW/ACT ecology regulatory intelligence briefing for a Senior Ecologist / Principal in an ecology consultancy. This is not a news digest. The briefing must match the supplied worked-example standard: a decision-useful bottom line, fully worked developments, a rolling watchlist, explicit no-material-change statements, actions for this week, register status, and confidence/gaps.

AUDIENCE AND DEPTH
Assume the reader understands BDAR, BAM, BAM-C, BAR, SAII, EPBC referrals and approval pathways. Do not explain basic concepts. Write enough detail that each material development can be understood and acted on without opening a second summary. Each development should normally contain 2-4 factual paragraphs plus dates, transitional treatment, commercial implications, affected work, affected projects, an action, conflicts and sources. Prefer fewer well-supported developments over padded coverage.

SOURCE-PACK METHOD
The attached source pack is the operating standard. Use its source registry, triage rules, active-LGA list and template as binding instructions. Search the listed official sources directly. The worked example is a formatting and reasoning reference only, not current evidence; do not copy its facts into the new brief unless independently re-verified. Report which source categories were checked and which could not be checked. Council coverage is limited to the supplied active-LGA list.

EVIDENCE HIERARCHY
Tier 1 — primary legislation registers, Acts, Regulations, SEPPs, commencement proclamations and legislative instruments. Definitive; cite provisions.
Tier 2 — official agency instruments: BAM, adopted guidelines, practice notes, TBDC/BioNet releases, BAM-C release notes, survey guides, planning circulars and formal determinations.
Tier 3 — official agency communications: newsletters, webpages, consultations, draft instruments and FAQs. Authoritative for what the agency said, not automatically for a change in law.
Tier 4 — discovery channels such as social media, mailing lists and webinars. Leads only; never cite as authority. Upgrade to the underlying instrument or place in Watchlist as UNVERIFIED.
Tier 5 — law firms, professional bodies, consultancies and media. Interpretation only, attributed, never the sole authority where an official source exists.

CONSEQUENTIALITY GATE
An item enters Developments only if a Senior Ecologist could reasonably need to do something differently about scope/fee, BAM or BDAR/BAR content, survey effort/timing/season, threatened-species method, vegetation mapping/data, avoid/minimise evidence, offsets/credit strategy, EPBC referral/assessment strategy, consent authority expectations, approval timeframe, conditions/certification/liability, or system/lodgement mechanics. Technical or data changes count even without a legislative status change. If zero triggers fire, place the item in Watchlist, No material change, or omit it.

STATUS AND DATE DISCIPLINE
Use exactly one status: COMMENCED LAW, MADE, NOT COMMENCED, ADOPTED POLICY / GUIDELINE, FORMAL AGENCY GUIDANCE, DRAFT / EXHIBITED, CONSULTATION PROPOSAL, EMERGING PRACTICE, or SYSTEM / ADMIN CHANGE. Record announced/published date, commencement/effective date, applies-to date and transitional treatment separately. Explicitly answer whether it affects a BDAR already in preparation, already lodged or already determined. Never guess; say no transitional provision located or unresolved where necessary.

CROSS-CHECKING AND CONFLICTS
For every material item, read the primary source and verify against an independent authoritative or credible source. If sources conflict, name both, explain the conflict, and state which is more credible and why. Distinguish Bill passage, assent, commencement and application dates. Law-firm commentary and LinkedIn cannot settle a legal date.

CONSULTING CONSEQUENCES
Every development ends with a concrete, assignable action: re-price a quote, add or change a survey season, bring fieldwork forward, check a named BDAR, revise a report/template, re-run BAM-C, brief a client/PM, update proposal exclusions, or flag certification exposure. For material items name affected work categories and only name projects from the supplied active roster.

REQUIRED BRIEF SECTIONS
1. Bottom line: 2-3 sentences identifying the dominant operational issue and overdue register exposure.
2. Developments: D1, D2 etc, each fully worked with jurisdiction, status, severity, dates, applies-from, triggers, What changed, Why it matters, transitional treatment, projects affected, commercial implications, sources, conflict note and action.
3. Watchlist: rolling items; each previous item must be closed with a reason, promoted to Developments, or carried forward with what changed.
4. No material change: explicit dated statements for every source category checked, plus categories not checked and why.
5. Actions for this week: numbered actions with owner, artefact affected, deadline and register ID where possible.
6. Register status: open count, severity counts, overdue items, effective-within-30-days not started, and unassigned high-severity items.
7. Confidence & gaps: confidence level, source conflicts, thin coverage, things not checked, unresolved questions and method blind spots.

SELF-AUDIT FAILURE MODES
Do not present consultation as current obligation; do not cite discovery or secondary commentary as primary authority; do not conflate passage and commencement; do not collapse staged reforms; do not omit transitional arrangements; do not pad Developments; do not write vague project impacts; do not silently drop watchlist items; do not issue a recommendation without reasoning.

OUTPUT
Respond with ONLY one valid JSON object. Use this shape:
{
  "bottom_line": "2-3 sentences",
  "overdue_register_count": 0,
  "status_matrix": [{"area":"BAM/BDAR","status":"green|amber|red","impact":"Low|Medium|High"}],
  "developments": [{
    "title":"short title","llc_recommendation":"no_action|monitor|update_llc|immediate_procedure_change","llc_reasoning":"why this level",
    "category":"BAM/BDAR|Threatened species|EPBC|Planning/Consent|Council|Offsets|Survey guidance|Other","jurisdiction":"NSW|ACT|Commonwealth|Council name",
    "legal_status":"commenced_law|made_not_commenced|adopted_policy|formal_guidance|draft_exhibited|consultation_proposal|emerging_practice|system_admin_change","severity":"HIGH|MEDIUM|LOW","triggers_fired":["T01"],
    "published_date":"YYYY-MM-DD or null","effective_date":"YYYY-MM-DD or null","applies_from":"text or null","transitional_treatment":"specific answer or no transitional provision located",
    "level1_notification":"1-2 sentences plus one action and deadline","what_changed":"2-4 factual sentences","why_it_matters":"specific operational and commercial consequence",
    "affected_work":["Quotes","Fieldwork"],"consulting_implications":{"quotes":"text or null","scoping":"text or null","reports":"text or null","project_program":"text or null"},
    "affected_projects":[{"project_name":"exact roster name","owner":"email or null","action":"specific action"}],"recommended_action":"assignable action","action_owner":"name/email or TBA","action_deadline":"YYYY-MM-DD or text or null","register_id":"ECR-#### or null",
    "sources":[{"title":"source","url":"https://...","tier":1,"accessed_date":"YYYY-MM-DD"}],"conflict_note":"text or null"
  }],
  "department_summaries":{"fieldwork":"text or null","reporting":"text or null","quoting":"text or null","approvals":"text or null"},
  "actions_this_week":[{"action":"specific action","owner":"name/email or TBA","artefact":"template/register/project","by_when":"date or text","register_id":"ECR-#### or null"}],
  "watchlist":[{"issue":"...","jurisdiction":"NSW|ACT|Commonwealth|Council name","potential_impact":"concrete","current_status":"one status label","next_milestone_date":"YYYY-MM-DD or null","likelihood":"High|Medium|Low","carried_forward_note":"what changed or null","source":"url or null"}],
  "no_material_change_categories":[{"category":"...","last_checked":"YYYY-MM-DD","statement":"No material change identified ..."}],
  "categories_not_checked":[{"category":"...","reason":"..."}],
  "register_status":{"open_items":0,"severity_counts":{"HIGH":0,"MEDIUM":0,"LOW":0},"overdue_items":["ECR-####"],"effective_within_30_days_not_started":0,"high_severity_unassigned":["ECR-####"]},
  "confidence_and_gaps":{"overall":"HIGH|MEDIUM|LOW","source_conflicts":["..."],"thin_coverage":["..."],"not_checked":["..."],"unresolved_questions":["..."],"method_blind_spots":["..."]},
  "source_coverage":[{"category":"...","sources_checked":[{"title":"...","url":"...","tier":1}],"checked_at":"YYYY-MM-DD","result":"material|no_material_change|not_checked","note":"..."}],
  "self_audit_passed":true
}

The final record must be deep enough to render as a worked brief, not merely a list of headlines.`;

function validateBriefDepth(brief) {
  const errors = [];
  if (!brief || typeof brief !== "object") errors.push("response is not an object");
  if (!String(brief?.bottom_line || "").trim()) errors.push("bottom_line is missing");
  if (!Array.isArray(brief?.developments)) errors.push("developments must be an array");
  if (!Array.isArray(brief?.watchlist)) errors.push("watchlist must be an array");
  if (!Array.isArray(brief?.actions_this_week)) errors.push("actions_this_week must be an array");
  if (!Array.isArray(brief?.no_material_change_categories)) errors.push("no_material_change_categories must be an array");
  if (!brief?.register_status || typeof brief.register_status !== "object") errors.push("register_status is missing");
  if (!brief?.confidence_and_gaps || typeof brief.confidence_and_gaps !== "object") errors.push("confidence_and_gaps is missing");
  if (!Array.isArray(brief?.source_coverage)) errors.push("source_coverage must be an array");
  const developments = Array.isArray(brief?.developments) ? brief.developments : [];
  developments.forEach((item, index) => {
    ["title", "legal_status", "severity", "what_changed", "transitional_treatment", "recommended_action", "sources"].forEach((field) => {
      if (item?.[field] == null || (typeof item[field] === "string" && !item[field].trim()) || (field === "sources" && !Array.isArray(item[field]))) errors.push(`developments[${index}].${field} is missing`);
    });
  });
  if (errors.length) throw new Error(`Legis depth validation failed: ${errors.join("; ")}`);
  return brief;
}

async function generateBrief(weekOf, previousWatchlist, projectRoster, sourcePack) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const watchlistContext = previousWatchlist?.length
    ? `Last week's watchlist, which must each be re-checked and closed, promoted to Developments, or carried forward with a note:\n${JSON.stringify(previousWatchlist, null, 2)}`
    : "No previous watchlist — this is the first briefing.";

  const rosterContext = projectRoster?.length
    ? `Real active project roster (name, client, lead email) — only ever name projects from this list in affected_projects, never invent a code:\n${JSON.stringify(projectRoster, null, 2)}`
    : "No active project roster was available — do not name any specific project in affected_projects this week.";
  const sourcePackContext = `SOURCE PACK — use as operating instructions, not as current evidence:\nACTIVE LGAS:\n${sourcePack.activeLgas}\nSOURCE REGISTRY:\n${sourcePack.sources}\nTRIAGE RULES:\n${sourcePack.triage}\nOUTPUT TEMPLATE:\n${sourcePack.template}\nWORKED EXAMPLE — FORMAT/DEPTH REFERENCE ONLY; DO NOT COPY ITS FACTS:\n${sourcePack.workedExample}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 10000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Produce this week's in-depth Legis briefing for the week commencing ${weekOf}. Search the last 7 days, re-check the supplied source categories, and write to the full worked-example contract. Do not return a short news summary.\n\n${sourcePackContext}\n\n${watchlistContext}\n\n${rosterContext}` }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const textBlocks = (data.content || []).filter((block) => block.type === "text").map((block) => block.text);
  const combined = textBlocks.join("\n").trim();
  const cleaned = combined.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    throw new Error(`Could not parse the briefing response as JSON: ${parseError.message}`);
  }
  return validateBriefDepth(parsed);
}

async function notifyAllStaff(admin, weekOf, urgentCount) {
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) { console.warn("Legis: could not list staff for notification:", usersError.message); return; }
  const recipients = (usersData?.users || []).filter((user) => /@ecologyconsulting\.au$/i.test(String(user.email || "")));
  if (!recipients.length) return;
  const { error } = await admin.from("portal_events").insert(recipients.map((user) => ({
    recipient_id: user.id,
    event_type: "legis_brief_ready",
    severity: urgentCount > 0 ? "action_required" : "information",
    title: urgentCount > 0 ? `Legis: ${urgentCount} item(s) need immediate procedure change` : "Legis briefing ready",
    body: `This week's regulatory briefing for the week of ${weekOf} is ready.`,
    href: "/staff/notifications",
    source_table: "monday_briefs",
  })));
  if (error) console.warn("Legis: could not create staff notifications:", error.message);
}

// Only update_llc and immediate_procedure_change represent a genuine
// register/procedure action — no_action and monitor are informational and
// belong in the brief only, not in the admin's Regulatory Watch queue.
async function feedRegulatoryWatch(admin, briefId, weekOf, developments) {
  const qualifying = (developments || []).filter((d) => ["update_llc", "immediate_procedure_change"].includes(d.llc_recommendation));
  if (!qualifying.length) return;

  const updateRows = qualifying.map((d) => ({
    source_id: null,
    title: `Legis: ${d.title}`,
    summary: `${d.what_changed || ""} Recommendation: ${d.llc_recommendation === "immediate_procedure_change" ? "Immediate procedure change" : "Update LLC"} — ${d.llc_reasoning || ""}`.trim().slice(0, 2000),
    source_url: d.sources?.[0]?.url || null,
    fingerprint: `legis-${briefId}-${d.title}`.slice(0, 200),
    affected_domains: ["Species Profiles & Survey Requirements", "Projects & Tracker", "Internal Governance"],
    severity: d.llc_recommendation === "immediate_procedure_change" ? "action" : "review",
    status: "new",
  }));
  const { error } = await admin.from("regulatory_updates").insert(updateRows);
  if (error && error.code !== "23505") console.warn("Legis: could not feed Regulatory Watch:", error.message);

  const registerRows = qualifying.map((d) => ({
    monday_brief_id: briefId,
    development_title: d.title,
    severity: d.severity || null,
    jurisdiction: d.jurisdiction || null,
    effective_date: d.effective_date || null,
    legal_status: d.legal_status || null,
    affected_templates_procedures: (d.affected_projects || []).map((p) => p.project_name).join(", ") || null,
    action_required: `${d.llc_recommendation === "immediate_procedure_change" ? "IMMEDIATE: " : ""}${d.recommended_action || ""}`.trim() || null,
    source_url: d.sources?.[0]?.url || null,
  }));
  if (registerRows.length) {
    const { error: registerError } = await admin.from("compliance_register_items").insert(registerRows);
    if (registerError) console.warn("Legis: could not seed compliance register:", registerError.message);
  }
}

export async function GET(request) {
  if (!jobAuthorised(request)) return Response.json({ error: "Unauthorised scheduler." }, { status: 401 });
  const admin = adminClient();
  const weekOf = mondayOf(new Date());

  try {
    const { data: existing } = await admin.from("monday_briefs").select("id, status").eq("week_of", weekOf).maybeSingle();
    if (existing?.status === "ready") return Response.json({ ok: true, message: "Already generated for this week.", brief_id: existing.id });

    const [{ data: previousBrief }, projectRoster] = await Promise.all([
      admin.from("monday_briefs").select("watchlist").eq("status", "ready").lt("week_of", weekOf).order("week_of", { ascending: false }).limit(1).maybeSingle(),
      loadActiveProjectRoster(admin),
    ]);

    const { data: briefRow, error: insertError } = await admin.from("monday_briefs").upsert({ week_of: weekOf, status: "generating", updated_at: new Date().toISOString() }, { onConflict: "week_of" }).select("id").single();
    if (insertError) throw new Error(insertError.message);

    const result = await generateBrief(weekOf, previousBrief?.watchlist, projectRoster, loadSourcePack());
    const urgentCount = (result.developments || []).filter((d) => d.llc_recommendation === "immediate_procedure_change").length;

    const { error: updateError } = await admin.from("monday_briefs").update({
      status: "ready",
      summary: result.bottom_line || "",
      developments: result.developments || [],
      actions_this_week: result.actions_this_week || [],
      watchlist: result.watchlist || [],
      no_material_change_categories: [...(result.no_material_change_categories || []), ...(result.categories_not_checked || []).map((c) => `${c} (not checked)`)],
      status_matrix: result.status_matrix || [],
      department_summaries: result.department_summaries || {},
      overdue_register_count: Number(result.overdue_register_count || result.register_status?.overdue_items?.length || 0),
      register_status: result.register_status || {},
      confidence_and_gaps: result.confidence_and_gaps || {},
      source_coverage: result.source_coverage || [],
      error_message: result.self_audit_passed === false ? "Model reported its own self-audit failed — review before circulating." : null,
      updated_at: new Date().toISOString(),
    }).eq("id", briefRow.id);
    if (updateError) throw new Error(updateError.message);

    await feedRegulatoryWatch(admin, briefRow.id, weekOf, result.developments);
    await notifyAllStaff(admin, weekOf, urgentCount);

    return Response.json({ ok: true, brief_id: briefRow.id, developments_found: (result.developments || []).length, immediate_procedure_change: urgentCount, self_audit_passed: result.self_audit_passed !== false });
  } catch (error) {
    await admin.from("monday_briefs").update({ status: "failed", error_message: String(error.message || error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("week_of", weekOf);
    return Response.json({ error: error.message || "Legis generation failed." }, { status: 500 });
  }
}
