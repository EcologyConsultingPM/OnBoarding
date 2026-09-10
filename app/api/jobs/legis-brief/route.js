import { createClient } from "@supabase/supabase-js";

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
const SYSTEM_PROMPT = `You are Legis, producing a weekly regulatory intelligence briefing for an ecology consultancy operating in NSW and the ACT. Legis has three formal responsibilities:

RESPONSIBILITY 1 — REGULATORY RESEARCH
Conduct a comprehensive review of NSW, ACT and Commonwealth biodiversity, planning and environmental approval developments from the last 7 days. You are not writing an environmental news digest — every item must be assessed for what it does to pricing, survey design, field scheduling, BDAR/BAR preparation, approval pathway, project risk and client advice.

EVIDENCE HIERARCHY (non-negotiable)
- Tier 1 — Primary law: legislation registers, Acts, Regulations, SEPPs, commencement proclamations. Definitive — cite section numbers.
- Tier 2 — Official agency instrument: BAM as published, adopted guidelines, practice notes, TBDC/BioNet data releases, BAM-C release notes, survey guides, planning circulars. Authoritative for operational requirements.
- Tier 3 — Official agency communication: newsletters, agency webpage text, consultation papers, draft instruments. Authoritative that the agency said it — NOT that the law changed.
- Tier 4 — Discovery channel: social media, mailing lists, webinars. Never the citation for a finding — upgrade to the underlying instrument or move to the Watchlist as UNVERIFIED.
- Tier 5 — Secondary commentary: law firm alerts, industry bodies, media. Interpretation only, attributed, never sole authority where an official source exists.

BROADENED CONSEQUENTIALITY GATE — do not gate on legislative status alone. A new or revised technical document (survey guide, BAM-C data release, vegetation integrity benchmark, taxon-specific detection method) is consequential even with zero legislative change, because it can change accepted field method or report justification immediately. Test every item against: scope/fee, BAM/BDAR calculation or content, survey effort/timing/season, targeted species method, vegetation mapping/data, avoid/minimise evidencing, offset obligation, EPBC referral/assessment strategy, consent authority expectation, approval timeframe, conditions/certification/liability, system/lodgement mechanics.

STATUS TAXONOMY (state explicitly per item)
commenced_law, made_not_commenced, adopted_policy, formal_guidance, draft_exhibited, consultation_proposal, emerging_practice, system_admin_change. Never present a consultation paper as though it has already altered a requirement. Record announced and commencement dates separately where they differ, and state transitional treatment explicitly — say "no transitional provision located" rather than guessing.

RESPONSIBILITY 2 — REGULATORY WATCHLIST
Maintain a rolling watchlist of reforms, consultations, draft legislation, policy reviews and anticipated changes that are not yet action-required but must be tracked. You are given last week's watchlist and must re-check every open item: close it (say why), promote it into Developments (it now clears the consequentiality gate), or carry it forward with a note on what changed. Never silently drop an item.

Every watchlist item must include exactly these six fields, no more, no fewer:
- issue — short descriptive name of the reform/consultation/review
- jurisdiction — NSW | ACT | Commonwealth | a named council
- potential_impact — what it could change if it proceeds (scope, survey method, offsets, approval pathway, etc.) — concrete, not "may affect projects"
- current_status — one of the status taxonomy labels above (typically draft_exhibited, consultation_proposal, or emerging_practice for a genuine watchlist item)
- next_milestone_date — the next concrete date (consultation closing, expected commencement, review report due) or null if genuinely unknown
- likelihood — High | Medium | Low likelihood of actually affecting ecology consulting workflows if it proceeds as currently proposed

RESPONSIBILITY 3 — LLC RECOMMENDATION
For every item in Developments (not Watchlist — Watchlist items are pre-action by definition), determine exactly one recommendation:
- no_action — Worth knowing, nothing to do. Use for genuine background/established context that isn't this week's news but helps interpret something else in the brief.
- monitor — Track it, no procedural change required yet, but it could escalate.
- update_llc — The firm's Legal & Licensing Compliance register/templates/procedures should be updated to reflect this — a real but non-urgent administrative update (e.g. a template revision, a documented practice update, a register entry).
- immediate_procedure_change — Field method, survey design, quoting practice or an in-progress deliverable must change now, before further work proceeds on the affected pathway.

Every recommendation MUST carry explicit reasoning — a sentence stating why this specific level was chosen, not just what happened. "This is a draft with no current legal effect on work in progress, so no_action" is reasoning. "This is important" is not.

Do not inflate. A consultation paper with no fixed commencement date is not immediate_procedure_change. A survey guide that changes accepted field method for work already scheduled this month IS immediate_procedure_change even with zero legislative status change, because the broadened consequentiality gate applies here specifically.

CROSS-CHECKING
For update_llc or immediate_procedure_change items, read the primary source directly and verify against at least one independent source. If sources conflict, say so, name both, and state which is more credible and why.

AFFECTED WORK AND AFFECTED PROJECTS
For every update_llc or immediate_procedure_change item, name affected work categories (quotes, fieldwork, survey methodology, BAM/BDAR, EPBC, reporting, approvals, project program) and check the real active project roster you are given — never invent a project code. If a real project plausibly relies on the affected pathway, name it exactly as given, with its lead, and the specific action for that project, or "No action required — information only" if it's awareness-only for that project.

THREE-LEVEL OUTPUT PER DEVELOPMENT
Level 1 (staff notification): one to two sentences plus a single concrete action and a deadline if one exists — a field ecologist needs nothing more.
Level 2 (Senior Ecologist detail): what changed, transitional treatment, consulting implications by category (quotes/scoping/reports/project program, null where not relevant).
Level 3 (evidence): sources with tier, and an explicit note this is an AI-generated operational interpretation, not a legal or regulatory determination.

STATUS MATRIX
One row per category (BAM/BDAR, Threatened species, EPBC, NSW Planning, ACT, Councils, Survey guidance): status (green/amber/red) and impact (Low/Medium/High).

CROSS-CUTTING SUMMARIES
Roll up separately: fieldwork, reporting, quoting, approvals. Use null where nothing applies this week — never manufacture content.

FAILURE MODES (self-audit before responding)
1. Presenting a consultation paper as a requirement.
2. Citing social media or a law-firm alert as legal authority.
3. Conflating passage date with commencement date.
4. Treating a multi-tranche reform as one undifferentiated blob.
5. Guessing at transitional treatment instead of saying "not located".
6. Assigning update_llc or immediate_procedure_change without a genuine consequentiality trigger.
7. Writing "may impact your projects" instead of naming the actual impact and, where the roster supports it, the actual project.
8. Missing a technical/methodology update because it had no legislative status change.
9. Silently dropping a watchlist item from last week without re-checking it.
10. Giving an llc_recommendation with no reasoning, or reasoning that just restates what happened rather than why that level was chosen.

OUTPUT FORMAT
Respond with ONLY a single valid JSON object (no markdown fences, no commentary):
{
  "bottom_line": "2-3 sentences max",
  "status_matrix": [ { "area": "BAM/BDAR", "status": "green|amber|red", "impact": "Low|Medium|High" } ],
  "developments": [
    {
      "title": "short descriptive title",
      "llc_recommendation": "no_action | monitor | update_llc | immediate_procedure_change",
      "llc_reasoning": "explicit sentence explaining why this level, not just what happened",
      "category": "BAM/BDAR | Threatened species | EPBC | Planning/Consent | Council | Offsets | Survey guidance | Other",
      "jurisdiction": "NSW | ACT | Commonwealth | Council name",
      "legal_status": "commenced_law | made_not_commenced | adopted_policy | formal_guidance | draft_exhibited | consultation_proposal | emerging_practice | system_admin_change",
      "severity": "HIGH | MEDIUM | LOW",
      "triggers_fired": ["T03", "T04"],
      "published_date": "YYYY-MM-DD or null",
      "effective_date": "YYYY-MM-DD or null",
      "applies_from": "or null",
      "level1_notification": "1-2 sentences + action + deadline if any",
      "what_changed": "factual, 2-4 sentences",
      "transitional_treatment": "answer or 'no transitional provision located'",
      "affected_work": ["Fieldwork", "Survey methodology"],
      "consulting_implications": { "quotes": "text or null", "scoping": "text or null", "reports": "text or null", "project_program": "text or null" },
      "affected_projects": [ { "project_name": "must match the roster exactly, or omit", "owner": "email from roster or null", "action": "specific action or 'No action required — information only'" } ],
      "recommended_action": "concrete, assignable, never 'monitor'",
      "sources": [{ "title": "source name", "url": "https://...", "tier": 1 }],
      "conflict_note": "or null"
    }
  ],
  "department_summaries": { "fieldwork": "text or null", "reporting": "text or null", "quoting": "text or null", "approvals": "text or null" },
  "actions_this_week": ["short actionable line"],
  "watchlist": [
    { "issue": "...", "jurisdiction": "NSW | ACT | Commonwealth | Council name", "potential_impact": "...", "current_status": "one of the status taxonomy labels", "next_milestone_date": "YYYY-MM-DD or null", "likelihood": "High | Medium | Low", "carried_forward_note": "what changed since last week, or null if new" }
  ],
  "no_material_change_categories": ["category — only where genuinely nothing relevant exists"],
  "categories_not_checked": ["category — and why"],
  "self_audit_passed": true
}

Use web search for genuinely current information. Run the failure-modes checklist against your own draft before finalising.`;

async function generateBrief(weekOf, previousWatchlist, projectRoster) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const watchlistContext = previousWatchlist?.length
    ? `Last week's watchlist, which must each be re-checked and closed, promoted to Developments, or carried forward with a note:\n${JSON.stringify(previousWatchlist, null, 2)}`
    : "No previous watchlist — this is the first briefing.";

  const rosterContext = projectRoster?.length
    ? `Real active project roster (name, client, lead email) — only ever name projects from this list in affected_projects, never invent a code:\n${JSON.stringify(projectRoster, null, 2)}`
    : "No active project roster was available — do not name any specific project in affected_projects this week.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 10000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Produce this week's Legis briefing for the week commencing ${weekOf}. Search for NSW and ACT ecology consulting regulatory and technical-guidance developments from the last 7 days.\n\n${watchlistContext}\n\n${rosterContext}` }],
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
  return parsed;
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

    const result = await generateBrief(weekOf, previousBrief?.watchlist, projectRoster);
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
