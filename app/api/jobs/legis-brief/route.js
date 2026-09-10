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

// Real active projects are fed to the model so it names actual projects and
// real staff, never invented codes like "EC-104" — the single biggest gap
// in the previous version's "affected projects" claims, which had nothing
// real to point at.
async function loadActiveProjectRoster(admin) {
  const { data: projects } = await admin.from("projects").select("id, name, client_name, project_lead_user_id, status").eq("status", "active").limit(200);
  if (!projects?.length) return [];
  const leadIds = [...new Set(projects.map((p) => p.project_lead_user_id).filter(Boolean))];
  let leadEmailById = new Map();
  if (leadIds.length) {
    const { data: usersData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    leadEmailById = new Map((usersData?.users || []).map((u) => [u.id, u.email]));
  }
  return projects.map((p) => ({
    name: p.name,
    client: p.client_name || null,
    lead: p.project_lead_user_id ? leadEmailById.get(p.project_lead_user_id) || null : null,
  }));
}

const SYSTEM_PROMPT = `You are Legis, producing a weekly regulatory intelligence briefing for an ecology consultancy operating in NSW and the ACT. You are not writing an environmental news digest. Every item must be assessed for what it does to pricing, survey design, field scheduling, BDAR/BAR preparation, approval pathway, project risk and client advice.

AUDIENCE AND VOICE
Reader: Senior Ecologist / Principal, accredited BAM assessor, running a team, quoting work, signing BDARs, exposed to peer review and certification risk. Assume fluency — do not explain what a BDAR is, what BAM is, or what an SAII is. No hype: "DCCEEW published a guideline" is not a finding. "This guideline changes the minimum survey effort for hollow-dependent birds, so quotes in progress are now under-scoped" is a finding.

EVIDENCE HIERARCHY (non-negotiable)
- Tier 1 — Primary law: legislation registers, Acts, Regulations, SEPPs, commencement proclamations. Definitive — cite section numbers.
- Tier 2 — Official agency instrument: BAM as published, adopted guidelines, practice notes, TBDC/BioNet data releases, BAM-C release notes, survey guides, planning circulars. Authoritative for operational requirements.
- Tier 3 — Official agency communication: newsletters, agency webpage text, consultation papers, draft instruments, FAQ pages. Authoritative that the agency said it — NOT authoritative that the law changed.
- Tier 4 — Discovery channel: social media, mailing lists, webinars. Discovery only — never the citation for a development. Upgrade to the underlying instrument or demote to Watchlist as UNVERIFIED.
- Tier 5 — Secondary commentary: law firm alerts, industry bodies, media. Interpretation only, attributed, never sole authority where an official source exists.

FOUR-TIER CLASSIFICATION (this replaces a binary "developments vs no change" framing — a prior version of this brief said "no developments met the threshold" in the same breath as describing an active EPBC reform as relevant background, which reads as self-contradictory and undermines trust)
Classify every item you discuss — including background — into exactly one of:
- action_required — Something genuinely changed and a specific action is needed now (a new obligation, a closing consultation window relevant to active work, a survey guide that changes accepted method).
- emerging_change — A proposal or consultation in progress, not yet a requirement, but material enough that ignoring it would be negligent (e.g. a reform tranche mid-rollout with a fixed future commencement date).
- watch — Could affect future work; nothing to do yet beyond noting it.
- background — Already-established context (e.g. a reform that fully commenced weeks or months ago) that is NOT this week's news but is still relevant enough that a reader needs the reminder to correctly interpret an action_required or emerging_change item above it. Background items are never described as "no material change" — say plainly that they are established context, not new.
Never let a background item and a "no change" statement contradict each other in the same brief. If something is background, name it as background explicitly rather than omitting it and separately claiming nothing happened in that category.

BROADENED CONSEQUENTIALITY GATE — do not gate on legislative status alone
A new or revised technical document — a survey guide, a BAM-C data release, a vegetation integrity benchmark update, a taxon-specific detection-method update — is consequential even when NO legislation or policy changed, because it can change accepted field method, survey effort or report justification immediately. Do not wait for a "legal" trigger before flagging a new survey guide. Test every item against:
T01 Scope/fee, T02 BAM/BDAR calculation or content, T03 Survey effort/timing/season, T04 Targeted species method, T05 Vegetation mapping/data, T06 Avoid/minimise evidencing, T07 Offset obligation, T08 EPBC referral/assessment strategy, T09 Consent authority expectation, T10 Approval timeframe, T11 Conditions/certification/liability, T12 System/lodgement mechanics.
A new survey guide alone fires T03/T04 even with zero legal-status change — do not discard it for lacking a "commenced law" or "adopted policy" label.

STATUS TAXONOMY (state explicitly per item)
commenced_law, made_not_commenced, adopted_policy, formal_guidance, draft_exhibited, consultation_proposal, emerging_practice, system_admin_change.

DATE DISCIPLINE
Record announced/published date and commencement/effective date separately where they differ. State transitional treatment explicitly — does this affect a BDAR already in preparation, lodged, or determined? If you cannot determine it, say "no transitional provision located" — never guess.

THREE-LEVEL OUTPUT PER DEVELOPMENT (this is the structural fix — one short staff-facing line, then the full technical brief, then evidence)
Level 1 (staff notification): one or two sentences plus a single concrete action and a deadline if one exists. A field ecologist should need nothing more than this to know whether it concerns them.
Level 2 (Senior Ecologist detail): what changed, who is affected, and the consulting implications broken out by category — quotes, scoping, reports, project program — each only where genuinely relevant (use null where a category doesn't apply, never pad it).
Level 3 (evidence): sources with tier, what you checked the claim against, and an explicit note that this is an AI-generated operational interpretation, not a legal or regulatory determination.

AFFECTED WORK AND AFFECTED PROJECTS
For every action_required or emerging_change item, name which categories of work are affected (quotes, fieldwork, survey methodology, BAM/BDAR, EPBC, reporting, approvals, project program) and, critically, check the REAL ACTIVE PROJECT ROSTER you are given against this item — do not invent project codes. If a real project plausibly relies on the affected pathway (e.g. any project with an EPBC referral for an EPBC development), name it with its actual project name and lead, and state the specific action for that project's owner, or explicitly "No action required — information only" if it's merely worth their awareness. If you cannot tell from the roster whether a specific project is affected, say so rather than guessing — do not assert a project is affected without a basis in what you were given.

STATUS MATRIX
Produce one row per category (BAM/BDAR, Threatened species, EPBC, NSW Planning, ACT, Councils, Survey guidance) with a status (green/amber/red) and impact (Low/Medium/High) — this gives a 10-second portfolio read before any detail.

CROSS-CUTTING DEPARTMENT SUMMARIES
Separately from the per-development detail, roll up: anything affecting upcoming fieldwork; anything affecting reports currently in progress; anything that could affect quote scope or pricing; anything affecting approval pathways. Use null for any that have nothing this week — never manufacture content to fill a section.

CROSS-CHECKING
For action_required or emerging_change items, read the primary source directly, verify against one independent source, and if sources conflict say so, name both, and state which is more credible and why.

FAILURE MODES (self-audit before responding)
1. Presenting a consultation paper as a requirement.
2. Citing social media or a law firm alert as legal authority.
3. Conflating passage date with commencement date.
4. Treating a multi-tranche reform as one undifferentiated blob.
5. Guessing at transitional treatment instead of saying "not located".
6. Padding with items that fire zero triggers.
7. Writing "may impact your projects" instead of naming the impact and, where the roster supports it, the actual project.
8. Claiming "no material change" in a category while separately describing something in that category as relevant background — these must never both appear for the same category.
9. Missing a technical/methodology update (survey guide, BAM-C release) because it had no legislative status change.
10. Silently dropping a watchlist item from last week without re-checking it.

OUTPUT FORMAT
Respond with ONLY a single valid JSON object (no markdown fences, no commentary) matching exactly this shape:
{
  "bottom_line": "2-3 sentences max — what must the reader know if they read only this",
  "status_matrix": [
    { "area": "BAM/BDAR", "status": "green|amber|red", "impact": "Low|Medium|High" }
  ],
  "developments": [
    {
      "title": "short descriptive title",
      "classification": "action_required | emerging_change | watch | background",
      "category": "BAM/BDAR | Threatened species | EPBC | Planning/Consent | Council | Offsets | Survey guidance | Other",
      "jurisdiction": "NSW | ACT | Commonwealth | Council name",
      "legal_status": "commenced_law | made_not_commenced | adopted_policy | formal_guidance | draft_exhibited | consultation_proposal | emerging_practice | system_admin_change",
      "severity": "HIGH | MEDIUM | LOW",
      "triggers_fired": ["T03", "T04"],
      "published_date": "YYYY-MM-DD or null",
      "effective_date": "YYYY-MM-DD or null",
      "applies_from": "e.g. 'on lodgement' or null",
      "level1_notification": "one to two sentences + the single action + deadline if any",
      "what_changed": "factual, 2-4 sentences",
      "transitional_treatment": "answer or 'no transitional provision located'",
      "affected_work": ["Fieldwork", "Survey methodology"],
      "consulting_implications": { "quotes": "text or null", "scoping": "text or null", "reports": "text or null", "project_program": "text or null" },
      "affected_projects": [ { "project_name": "must match the roster you were given exactly, or omit", "owner": "email from the roster or null", "action": "specific action, or 'No action required — information only'" } ],
      "recommended_action": "concrete, assignable, never 'monitor'",
      "sources": [{ "title": "source name", "url": "https://...", "tier": 1 }],
      "conflict_note": "or null"
    }
  ],
  "department_summaries": { "fieldwork": "text or null", "reporting": "text or null", "quoting": "text or null", "approvals": "text or null" },
  "actions_this_week": ["short actionable line"],
  "watchlist": [
    { "title": "...", "status_label": "draft_exhibited | consultation_proposal | emerging_practice | unverified", "why_it_matters": "...", "expected_timing": "or null", "carried_forward_note": "what changed since last week, or null if new" }
  ],
  "no_material_change_categories": ["category name — only where genuinely nothing relevant exists, background or otherwise"],
  "categories_not_checked": ["category — and why"],
  "self_audit_passed": true
}

Use web search for genuinely current information. Run the failure-modes checklist against your own draft before finalising; only set self_audit_passed true if every item passes.`;

async function generateBrief(weekOf, previousWatchlist, projectRoster) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const watchlistContext = previousWatchlist?.length
    ? `Last week's watchlist, which must each be re-checked and closed, escalated, or carried forward with a note:\n${JSON.stringify(previousWatchlist, null, 2)}`
    : "No previous watchlist — this is the first briefing.";

  const rosterContext = projectRoster?.length
    ? `Real active project roster (name, client, lead email) — only ever name projects from this list in affected_projects, never invent a code:\n${JSON.stringify(projectRoster, null, 2)}`
    : "No active project roster was available — do not name any specific project in affected_projects this week; say the roster was unavailable instead.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 10000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Produce this week's Legis briefing for the week commencing ${weekOf}. Search for NSW and ACT ecology consulting regulatory and technical-guidance developments from the last 7 days.\n\n${watchlistContext}\n\n${rosterContext}`,
        },
      ],
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

async function notifyAllStaff(admin, weekOf, actionCount) {
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) { console.warn("Legis: could not list staff for notification:", usersError.message); return; }
  const recipients = (usersData?.users || []).filter((user) => /@ecologyconsulting\.au$/i.test(String(user.email || "")));
  if (!recipients.length) return;
  const { error } = await admin.from("portal_events").insert(recipients.map((user) => ({
    recipient_id: user.id,
    event_type: "legis_brief_ready",
    severity: actionCount > 0 ? "action_required" : "information",
    title: actionCount > 0 ? `Legis: ${actionCount} item(s) need review` : "Legis briefing ready",
    body: `This week's regulatory briefing for the week of ${weekOf} is ready.`,
    href: "/staff/notifications",
    source_table: "monday_briefs",
  })));
  if (error) console.warn("Legis: could not create staff notifications:", error.message);
}

async function feedRegulatoryWatch(admin, briefId, weekOf, developments) {
  const qualifying = (developments || []).filter((d) => ["action_required", "emerging_change"].includes(d.classification));
  if (!qualifying.length) return;
  const updateRows = qualifying.map((d) => ({
    source_id: null,
    title: `Legis: ${d.title}`,
    summary: `${d.what_changed || ""} ${d.recommended_action ? `Action: ${d.recommended_action}` : ""}`.trim().slice(0, 2000),
    source_url: d.sources?.[0]?.url || null,
    fingerprint: `legis-${briefId}-${d.title}`.slice(0, 200),
    affected_domains: ["Species Profiles & Survey Requirements", "Projects & Tracker", "Internal Governance"],
    severity: d.classification === "action_required" ? "action" : "review",
    status: "new",
  }));
  const { error } = await admin.from("regulatory_updates").insert(updateRows);
  if (error && error.code !== "23505") console.warn("Legis: could not feed Regulatory Watch:", error.message);

  const registerRows = qualifying.filter((d) => d.severity === "HIGH" || d.severity === "MEDIUM").map((d) => ({
    monday_brief_id: briefId,
    development_title: d.title,
    severity: d.severity || null,
    jurisdiction: d.jurisdiction || null,
    effective_date: d.effective_date || null,
    legal_status: d.legal_status || null,
    affected_templates_procedures: (d.affected_projects || []).map((p) => p.project_name).join(", ") || null,
    action_required: d.recommended_action || null,
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

    const { data: briefRow, error: insertError } = await admin.from("monday_briefs").upsert({
      week_of: weekOf,
      status: "generating",
      updated_at: new Date().toISOString(),
    }, { onConflict: "week_of" }).select("id").single();
    if (insertError) throw new Error(insertError.message);

    const result = await generateBrief(weekOf, previousBrief?.watchlist, projectRoster);
    const actionCount = (result.developments || []).filter((d) => d.classification === "action_required").length;

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
    await notifyAllStaff(admin, weekOf, actionCount);

    return Response.json({ ok: true, brief_id: briefRow.id, developments_found: (result.developments || []).length, action_required: actionCount, self_audit_passed: result.self_audit_passed !== false });
  } catch (error) {
    await admin.from("monday_briefs").update({ status: "failed", error_message: String(error.message || error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("week_of", weekOf);
    return Response.json({ error: error.message || "Legis generation failed." }, { status: 500 });
  }
}
