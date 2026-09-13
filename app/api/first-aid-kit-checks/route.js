import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { data, error } = await access.admin
      .from("first_aid_kit_checks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return jsonError(error.message);

    return Response.json({ checks: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();

    if (!body.check_date) return jsonError("Check date is required.");
    if (!body.signature) return jsonError("A signature is required to submit.");

    const row = {
      checked_by: access.user.id,
      check_date: body.check_date,
      kit_a_items: body.kit_a_items || [],
      kit_a_outcome: body.kit_a_outcome || null,
      kit_b_items: body.kit_b_items || [],
      kit_b_outcome: body.kit_b_outcome || null,
      kit_b_notes: body.kit_b_notes || null,
      kit_c_items: body.kit_c_items || [],
      kit_c_outcome: body.kit_c_outcome || null,
      restock_register: body.restock_register || [],
      usage_notes: body.usage_notes || null,
      signature: body.signature,
    };

    const { data, error } = await access.admin.from("first_aid_kit_checks").insert(row).select("*").single();
    if (error) return jsonError(error.message);

    // Any failed kit or restock item raises a WHS notification — a kit
    // removed from service or an item needing replacement shouldn't wait
    // for someone to notice on the next check.
    const failed = ["kit_a_outcome", "kit_b_outcome", "kit_c_outcome"].some((k) => String(row[k] || "").toLowerCase().includes("failed"));
    const needsRestock = (row.restock_register || []).length > 0;
    if (failed || needsRestock) {
      const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const officers = (usersData?.users || []).filter((u) => /@ecologyconsulting\.au$/i.test(u.email || "") && (u.user_metadata?.whs_officer === true || u.user_metadata?.is_primary_admin === true));
      if (officers.length) {
        await access.admin.from("portal_events").insert(officers.map((officer) => ({
          recipient_id: officer.id,
          event_type: "first_aid_kit_issue",
          severity: failed ? "action_required" : "information",
          title: failed ? "First aid kit removed from service" : "First aid kit restock needed",
          body: `Check submitted ${body.check_date} by the field crew.`,
          href: "/staff/whs-forms?domain=first-aid",
          source_table: "first_aid_kit_checks",
          source_id: data.id,
        })));
      }
    }

    return Response.json({ check: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
