import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, week_of, status, summary, developments, actions_this_week, watchlist, no_material_change_categories, status_matrix, department_summaries, created_at, updated_at";

// Manual imports and older scheduler versions may have stored a watchlist as
// plain strings. The client renders structured watch records, so normalise at
// the protected boundary rather than allowing one malformed legacy item to
// degrade an otherwise ready weekly briefing.
function normaliseBrief(brief) {
  if (!brief) return null;
  return {
    ...brief,
    developments: Array.isArray(brief.developments) ? brief.developments : [],
    actions_this_week: Array.isArray(brief.actions_this_week) ? brief.actions_this_week : [],
    no_material_change_categories: Array.isArray(brief.no_material_change_categories) ? brief.no_material_change_categories : [],
    status_matrix: Array.isArray(brief.status_matrix) ? brief.status_matrix : [],
    department_summaries: brief.department_summaries && typeof brief.department_summaries === "object" && !Array.isArray(brief.department_summaries) ? brief.department_summaries : {},
    watchlist: (Array.isArray(brief.watchlist) ? brief.watchlist : []).map((item) => (
      typeof item === "string" ? { issue: item, likelihood: "Monitor", potential_impact: "Monitor the stated milestone and update the project pathway or methodology record if it changes." } : item
    )).filter((item) => item && typeof item === "object"),
  };
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { searchParams } = new URL(request.url);
    const history = searchParams.get("history") === "true";

    if (history) {
      const { data, error } = await access.admin.from("monday_briefs").select(COLUMNS).eq("status", "ready").order("week_of", { ascending: false }).limit(12);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ briefs: (data || []).map(normaliseBrief) });
    }

    // Staff should receive the latest usable briefing. Scheduler failures are
    // operational/admin concerns and must not replace a valid prior briefing.
    const { data, error } = await access.admin.from("monday_briefs").select(COLUMNS).eq("status", "ready").order("week_of", { ascending: false }).limit(1).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ brief: normaliseBrief(data) });
  } catch (error) {
    return serverError(error);
  }
}
