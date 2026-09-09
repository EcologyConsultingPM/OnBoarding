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
  if (!url || !key) throw new Error("Monday Brief requires Supabase server credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// The full editorial methodology this briefing follows — deliberately
// verbatim to what was specified, not a paraphrase, since the exact
// distinctions (commenced law vs consultation paper, announcement date vs
// effective date, consequential vs routine) are the whole point of the brief
// being trustworthy enough to act on.
const SYSTEM_PROMPT = `You are producing a weekly briefing for a Senior Ecologist at an ecology consulting firm operating across NSW and the ACT. You are writing for a working consultant who needs to know what actually changed and what to do about it — not a general news summary.

HIERARCHY OF EVIDENCE
Treat a change appearing in legislation or an official agency instrument very differently from a consultation paper, council webpage change, industry newsletter or anecdotal practice shift. Never present a consultation proposal as though it has already altered BAM or approval requirements.

YOUR REVIEW PROCESS
1. Scan for developments since the previous briefing (assume roughly the last 7 days unless told otherwise): new legislation, amendments, commencement dates, guidelines, practice notes, technical updates, survey guidance, consultation material, system/process changes, and consequential agency announcements.
2. Determine whether each development is actually consequential. Do not include every environmental announcement. Prioritise developments that could reasonably change: scope or fee estimates; BAM calculations or BDAR requirements; survey effort, timing or seasonal windows; targeted threatened-species methods; vegetation mapping or data requirements; avoidance/minimisation expectations; offset obligations; EPBC referral or assessment strategy; consent authority expectations; approval timeframes or information requests; conditions, peer review or certification risk.
3. Establish legal/process status explicitly for each item: commenced law, adopted policy/guideline, formal agency guidance, draft material, consultation proposal, or emerging practice. Be precise — this distinction is the most important thing you produce.
4. Check dates carefully. Distinguish the date something was announced from its commencement/effective date. Note transitional arrangements where relevant, since these matter most for projects already underway.
5. Cross-check material claims — prefer the primary source, and where practical verify interpretation against a second authoritative or credible source before treating something as confirmed.
6. Translate every development into consulting consequences. Never stop at "DCCEEW released a new guideline" — explain what a consultant might actually do differently: add contingency to a quote, change a proposed survey program, check an existing BDAR, revise a template, advise a PM about approval risk, or bring fieldwork forward before a seasonal window closes.

PRIMARY SOURCES (prioritise these; verify important claims against them)
- NSW DCCEEW / Environment and Heritage — Biodiversity Offsets Scheme, BAM, accredited assessor material, threatened-species resources, biodiversity policy and guidance
- NSW legislation — Biodiversity Conservation Act 2016, Biodiversity Conservation Regulation, environmental planning legislation and amending instruments
- BAM and Biodiversity Offsets Scheme resources — methodology changes, operational guidance, assessor communications
- BioNet — threatened species profiles, survey information, biodiversity data and process changes
- NSW threatened-species survey guidance, including species/taxon-specific requirements affecting assessment adequacy
- NSW Planning / Planning Portal — biodiversity assessment requirements, application processes, SSD/SSI changes, planning reforms, digital submission requirements
- Commonwealth DCCEEW — EPBC Act policy, referrals, assessment guidance, threatened ecological communities/species guidance, reforms
- Federal Register of Legislation — for verifying legislative wording, commencement or amendments
- ACT Government environment and planning agencies — Nature Conservation, threatened species, environmental assessment, planning approval
- ACT legislation and legislative instruments
- NSW and ACT councils — only where a council introduces a consequential biodiversity, vegetation, development-assessment, mapping, ecological-reporting or pre-lodgement requirement

SECONDARY SOURCES
Consultancy alerts, ecological-industry commentary, legal updates and professional bodies can help you identify that something happened, but never rely on them as the sole authority where an official source exists.

WHEN THERE IS NO MATERIAL CHANGE
Say so explicitly for major categories (e.g. "No material BAM changes this week"). Do not manufacture significance from a routine agency update just because it is new.

OUTPUT FORMAT
Respond with ONLY a single valid JSON object (no markdown fences, no commentary before or after) matching exactly this shape:
{
  "summary": "2-3 sentence overview of the week for a consultant skimming on a Monday morning",
  "developments": [
    {
      "title": "short descriptive title",
      "category": "one of: BAM/BDAR, Threatened species, EPBC, Planning/Consent, Council, Offsets, Survey guidance, Other",
      "jurisdiction": "NSW | ACT | Commonwealth | Council name",
      "legal_status": "one of: commenced_law, adopted_policy, formal_guidance, draft_material, consultation, emerging_practice",
      "published_date": "YYYY-MM-DD or null if unknown",
      "effective_date": "YYYY-MM-DD or null if not yet effective or not applicable",
      "what_changed": "factual description of the actual change",
      "practical_consequences": "what this changes for scope, fees, survey design, methods, timing, approvals or risk",
      "recommended_action": "a concrete action worth taking this week, or null if awareness-only",
      "sources": [{"title": "source name", "url": "https://..."}]
    }
  ],
  "actions_this_week": ["short actionable line", "..."],
  "watchlist": [
    { "title": "what to watch", "why_it_matters": "why this matters if/when it lands", "expected_timing": "e.g. consultation closes March 2026, or null" }
  ],
  "no_material_change_categories": ["BAM", "EPBC", "..."]
}

Use your web search capability to find genuinely current information — do not rely solely on prior knowledge, which may be out of date. If you find nothing consequential in a category this week, that is a valid and expected outcome — reflect it in no_material_change_categories rather than inventing a development.`;

async function generateBrief(weekOf) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Produce this week's briefing for the week commencing ${weekOf}. Search for NSW and ACT ecology consulting regulatory developments from the last 7 days and produce the JSON output as specified.`,
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

async function notifyAllStaff(admin, weekOf) {
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) { console.warn("Monday Brief: could not list staff for notification:", usersError.message); return; }
  const recipients = (usersData?.users || []).filter((user) => /@ecologyconsulting\.au$/i.test(String(user.email || "")));
  if (!recipients.length) return;
  const { error } = await admin.from("portal_events").insert(recipients.map((user) => ({
    recipient_id: user.id,
    event_type: "monday_brief_ready",
    severity: "information",
    title: "Monday Brief ready",
    body: `This week's regulatory briefing for the week of ${weekOf} is ready to review.`,
    href: "/staff/notifications",
    source_table: "monday_briefs",
  })));
  if (error) console.warn("Monday Brief: could not create staff notifications:", error.message);
}

// Best-effort: qualifying developments (anything above draft/consultation
// status) are also surfaced in the admin Regulatory Watch register, so an
// admin reviewing regulatory changes sees both automated source-monitoring
// results and AI-researched developments in one place. This creates a
// review-required update, exactly like the existing source-monitoring job —
// it never changes requirements or notifies staff on its own.
async function feedRegulatoryWatch(admin, briefId, weekOf, developments) {
  const qualifying = (developments || []).filter((d) => !["draft_material", "consultation", "emerging_practice"].includes(d.legal_status));
  if (!qualifying.length) return;
  const rows = qualifying.map((d) => ({
    source_id: null,
    title: `Monday Brief: ${d.title}`,
    summary: `${d.what_changed || ""} ${d.practical_consequences ? `Practical consequences: ${d.practical_consequences}` : ""}`.trim().slice(0, 2000),
    source_url: d.sources?.[0]?.url || null,
    fingerprint: `monday-brief-${briefId}-${d.title}`.slice(0, 200),
    affected_domains: ["Species Profiles & Survey Requirements", "Projects & Tracker", "Internal Governance"],
    severity: "review",
    status: "new",
  }));
  const { error } = await admin.from("regulatory_updates").insert(rows);
  if (error && error.code !== "23505") console.warn("Monday Brief: could not feed Regulatory Watch:", error.message);
}

export async function GET(request) {
  if (!jobAuthorised(request)) return Response.json({ error: "Unauthorised scheduler." }, { status: 401 });
  const admin = adminClient();
  const weekOf = mondayOf(new Date());

  try {
    const { data: existing } = await admin.from("monday_briefs").select("id, status").eq("week_of", weekOf).maybeSingle();
    if (existing?.status === "ready") return Response.json({ ok: true, message: "Already generated for this week.", brief_id: existing.id });

    const { data: briefRow, error: insertError } = await admin.from("monday_briefs").upsert({
      week_of: weekOf,
      status: "generating",
      updated_at: new Date().toISOString(),
    }, { onConflict: "week_of" }).select("id").single();
    if (insertError) throw new Error(insertError.message);

    const result = await generateBrief(weekOf);

    const { error: updateError } = await admin.from("monday_briefs").update({
      status: "ready",
      summary: result.summary || "",
      developments: result.developments || [],
      actions_this_week: result.actions_this_week || [],
      watchlist: result.watchlist || [],
      no_material_change_categories: result.no_material_change_categories || [],
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", briefRow.id);
    if (updateError) throw new Error(updateError.message);

    await feedRegulatoryWatch(admin, briefRow.id, weekOf, result.developments);
    await notifyAllStaff(admin, weekOf);

    return Response.json({ ok: true, brief_id: briefRow.id, developments_found: (result.developments || []).length });
  } catch (error) {
    await admin.from("monday_briefs").update({ status: "failed", error_message: String(error.message || error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("week_of", weekOf);
    return Response.json({ error: error.message || "Monday Brief generation failed." }, { status: 500 });
  }
}
