import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS =
  "id, name, client_name, client_contact, sharepoint_link, description, start_date, end_date, budget_hours, budget_dollars, default_hourly_rate, status, created_at, updated_at";

function opt(value) {
  const t = typeof value === "string" ? value.trim() : "";
  return t || null;
}
function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    // RLS already limits staff to their allocated projects; no extra filter needed.
    const { data, error } = await access.admin
      .from("projects")
      .select(COLUMNS)
      .order("updated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ projects: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can create projects." }, { status: 403 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return Response.json({ error: "A project name is required." }, { status: 400 });

    const { data, error } = await access.admin
      .from("projects")
      .insert({
        created_by: access.user.id,
        name,
        client_name: opt(body.clientName),
        client_contact: opt(body.clientContact),
        sharepoint_link: opt(body.sharepointLink),
        description: opt(body.description),
        start_date: opt(body.startDate),
        end_date: opt(body.endDate),
        budget_hours: num(body.budgetHours),
        budget_dollars: num(body.budgetDollars),
        default_hourly_rate: num(body.defaultHourlyRate),
        status: opt(body.status) || "active",
      })
      .select(COLUMNS)
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ project: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
