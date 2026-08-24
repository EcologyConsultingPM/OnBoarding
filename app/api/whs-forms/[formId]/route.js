import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, form_type, title, site, form_date, details, status, notifiable_flag, review_note, reviewed_by, reviewed_at, created_by, created_at, updated_at";

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const b = await request.json();

    // Admin review actions.
    if (["reviewed", "actioned", "archived"].includes(b.action)) {
      if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
      const { data, error } = await access.admin.from("whs_forms").update({
        status: b.action,
        review_note: (b.review_note || "").toString().trim() || null,
        notifiable_flag: typeof b.notifiable_flag === "boolean" ? b.notifiable_flag : undefined,
        reviewed_by: access.user.id,
        reviewed_at: new Date().toISOString(),
      }).eq("id", params.formId).select(COLUMNS).single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ form: data });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return serverError(error);
  }
}
