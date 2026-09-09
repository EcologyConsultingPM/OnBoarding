import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { searchParams } = new URL(request.url);
    const history = searchParams.get("history") === "true";

    if (history) {
      const { data, error } = await access.admin
        .from("monday_briefs")
        .select("id, week_of, status, summary, developments, actions_this_week, watchlist, no_material_change_categories, created_at")
        .eq("status", "ready")
        .order("week_of", { ascending: false })
        .limit(12);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ briefs: data || [] });
    }

    const { data, error } = await access.admin
      .from("monday_briefs")
      .select("id, week_of, status, summary, developments, actions_this_week, watchlist, no_material_change_categories, created_at")
      .order("week_of", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ brief: data || null });
  } catch (error) {
    return serverError(error);
  }
}
