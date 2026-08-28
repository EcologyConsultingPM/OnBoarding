import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Maps a URL ?type= to its table plus the fields we accept from the client.
// Keeping this in one place means the four record types stay consistent and
// there is a single owner/admin enforcement path.
const TYPES = {
  profiles: {
    table: "remote_work_profiles",
    columns:
      "id, staff_name, base_location, time_zone, overlap_hours, availability, arrangement_notes, status, admin_note, created_by, created_at, updated_at",
    fields: {
      staff_name: "staffName",
      base_location: "baseLocation",
      time_zone: "timeZone",
      overlap_hours: "overlapHours",
      availability: "availability",
      arrangement_notes: "arrangementNotes",
    },
    adminFields: { admin_note: "adminNote", status: "status" },
  },
  "client-records": {
    table: "remote_client_records",
    columns:
      "id, project_id, kind, title, record_detail, start_date, follow_up_date, status, admin_response, created_by, created_at, updated_at",
    fields: {
      project_id: "projectId",
      kind: "kind",
      title: "title",
      record_detail: "recordDetail",
      start_date: "startDate",
      follow_up_date: "followUpDate",
    },
    adminFields: { admin_response: "adminResponse", status: "status" },
    required: "title",
  },
  quotes: {
    table: "remote_quotes",
    columns:
      "id, project_id, quote_reference, quote_stage, quote_value_aud, quote_date, commercial_notes, admin_note, created_by, created_at, updated_at",
    fields: {
      project_id: "projectId",
      quote_reference: "quoteReference",
      quote_stage: "quoteStage",
      quote_value_aud: "quoteValueAud",
      quote_date: "quoteDate",
      commercial_notes: "commercialNotes",
    },
    adminFields: { admin_note: "adminNote", quote_stage: "quoteStage" },
    numeric: ["quote_value_aud"],
  },
  issues: {
    table: "remote_issues",
    columns:
      "id, project_id, issue_type, title, detail, status, admin_response, resolved_at, created_by, created_at, updated_at",
    fields: {
      project_id: "projectId",
      issue_type: "issueType",
      title: "title",
      detail: "detail",
    },
    adminFields: { admin_response: "adminResponse", status: "status" },
    required: "title",
  },
};

function opt(value) {
  const t = typeof value === "string" ? value.trim() : "";
  return t || null;
}
function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapFields(spec, body, fieldSet) {
  const out = {};
  for (const [column, key] of Object.entries(fieldSet)) {
    if (!(key in body)) continue;
    out[column] = spec.numeric?.includes(column)
      ? num(body[key])
      : opt(body[key]);
  }
  return out;
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { searchParams } = new URL(request.url);
    const spec = TYPES[searchParams.get("type")];
    if (!spec)
      return Response.json({ error: "Unknown record type." }, { status: 400 });

    // The server uses the service-role client, so staff isolation must be explicit
    // here rather than delegated to RLS. Administrators can review all records.
    let query = access.admin
      .from(spec.table)
      .select(spec.columns)
      .order("updated_at", { ascending: false });
    if (!access.isAdmin) query = query.eq("created_by", access.user.id);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ records: data || [], isAdmin: access.isAdmin });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { searchParams } = new URL(request.url);
    const spec = TYPES[searchParams.get("type")];
    if (!spec)
      return Response.json({ error: "Unknown record type." }, { status: 400 });

    // Commercial quotes and client coordination are controlled management records.
    // Staff may submit only their own remote-work context and delivery-support items.
    if (
      ["quotes", "client-records"].includes(searchParams.get("type")) &&
      !access.isAdmin
    ) {
      return Response.json(
        { error: "Administrator access is required for this record type." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const values = mapFields(spec, body, spec.fields);
    if (spec.required && !values[spec.required]) {
      return Response.json({ error: "A title is required." }, { status: 400 });
    }
    const { data, error } = await access.admin
      .from(spec.table)
      .insert({ ...values, created_by: access.user.id })
      .select(spec.columns)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ record: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: owner edits their own fields; admin actions/responds. Which fields are
// allowed depends on who is calling — admins additionally get adminFields.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { searchParams } = new URL(request.url);
    const spec = TYPES[searchParams.get("type")];
    const id = searchParams.get("id");
    if (!spec || !id)
      return Response.json(
        { error: "Record type and id are required." },
        { status: 400 },
      );

    const { data: existing } = await access.admin
      .from(spec.table)
      .select("id, created_by")
      .eq("id", id)
      .maybeSingle();
    if (!existing)
      return Response.json({ error: "Record not found." }, { status: 404 });
    const isOwner = existing.created_by === access.user.id;
    if (!isOwner && !access.isAdmin)
      return Response.json(
        { error: "You do not have access to this record." },
        { status: 403 },
      );

    const body = await request.json();
    let values = {};
    if (isOwner) values = { ...values, ...mapFields(spec, body, spec.fields) };
    if (access.isAdmin)
      values = { ...values, ...mapFields(spec, body, spec.adminFields) };
    if (!Object.keys(values).length)
      return Response.json({ error: "Nothing to update." }, { status: 400 });

    const { data, error } = await access.admin
      .from(spec.table)
      .update(values)
      .eq("id", id)
      .select(spec.columns)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ record: data });
  } catch (error) {
    return serverError(error);
  }
}
