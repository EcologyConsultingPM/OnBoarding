import { requireSession, serverError } from "../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rowTypes = new Set(["hazard", "psychosocial"]);

function optionalText(value, maximum = 6000) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maximum) : null;
}

async function draftAccess(access, draftId) {
  const { data: draft, error } = await access.admin
    .from("whs_drafts")
    .select("id, created_by, status")
    .eq("id", draftId)
    .maybeSingle();

  if (error || !draft) return { response: Response.json({ error: "WHS draft not found." }, { status: 404 }) };
  if (!access.isAdmin && draft.created_by !== access.user.id) {
    return { response: Response.json({ error: "You do not have access to this WHS draft." }, { status: 403 }) };
  }
  return { draft };
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const authorisation = await draftAccess(access, params.draftId);
    if (authorisation.response) return authorisation.response;

    const { data, error } = await access.admin
      .from("whs_draft_risk_rows")
      .select("id, draft_id, row_number, row_type, description, people_at_risk, existing_controls, proposed_controls, residual_risk, created_at, updated_at")
      .eq("draft_id", params.draftId)
      .order("row_type", { ascending: true })
      .order("row_number", { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ rows: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const authorisation = await draftAccess(access, params.draftId);
    if (authorisation.response) return authorisation.response;
    if (authorisation.draft.status === "approved") {
      return Response.json({ error: "Approved drafts cannot be edited." }, { status: 409 });
    }

    const body = await request.json();
    if (!Array.isArray(body.rows) || body.rows.length > 100) {
      return Response.json({ error: "Provide no more than 100 numbered rows." }, { status: 400 });
    }

    const rowNumbers = new Map();
    const rows = body.rows
      .map((row) => ({
        row_type: row.rowType,
        description: typeof row.description === "string" ? row.description.trim() : "",
        people_at_risk: optionalText(row.peopleAtRisk),
        existing_controls: optionalText(row.existingControls),
        proposed_controls: optionalText(row.proposedControls),
        residual_risk: optionalText(row.residualRisk, 120),
      }))
      .filter((row) => row.description.length > 0);

    for (const row of rows) {
      if (!rowTypes.has(row.row_type)) {
        return Response.json({ error: "Each row must be a hazard or psychosocial factor." }, { status: 400 });
      }
      const nextNumber = (rowNumbers.get(row.row_type) || 0) + 1;
      rowNumbers.set(row.row_type, nextNumber);
      row.row_number = nextNumber;
      row.draft_id = params.draftId;
    }

    const { error: deleteError } = await access.admin
      .from("whs_draft_risk_rows")
      .delete()
      .eq("draft_id", params.draftId);
    if (deleteError) return Response.json({ error: deleteError.message }, { status: 400 });

    if (rows.length) {
      const { error: insertError } = await access.admin
        .from("whs_draft_risk_rows")
        .insert(rows);
      if (insertError) return Response.json({ error: insertError.message }, { status: 400 });
    }

    await access.admin
      .from("whs_drafts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", params.draftId);

    return Response.json({ saved: rows.length, draftId: params.draftId });
  } catch (error) {
    return serverError(error);
  }
}
