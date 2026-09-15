import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { data, error } = await access.admin
      .from("deliverable_templates")
      .select("id, code, name, standard_activities")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ templates: data || [] });
  } catch (error) {
    return serverError(error);
  }
}
