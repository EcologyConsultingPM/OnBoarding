import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff-side feedback loop: what has an outcome the person hasn't seen, and what
// needs their attention. Powers the staff home badge + a "recent outcomes" list.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const uid = access.user.id;

    // Their service requests that reached a decision (approved/declined).
    const { data: reqs } = await access.admin
      .from("service_requests")
      .select("id, request_type, title, status, admin_note, reviewed_at, updated_at, seen_by_staff")
      .eq("created_by", uid)
      .in("status", ["approved", "declined"])
      .order("reviewed_at", { ascending: false });

    // Their WHS forms that have been reviewed/actioned.
    const { data: whs } = await access.admin
      .from("whs_forms")
      .select("id, form_type, title, status, review_note, reviewed_at, seen_by_staff")
      .eq("created_by", uid)
      .in("status", ["reviewed", "actioned"])
      .order("reviewed_at", { ascending: false });

    const outcomes = [
      ...(reqs || []).map((r) => ({ kind: "request", id: r.id, title: r.title, type: r.request_type, status: r.status, note: r.admin_note, at: r.reviewed_at, seen: r.seen_by_staff })),
      ...(whs || []).map((w) => ({ kind: "whs", id: w.id, title: w.title, type: w.form_type, status: w.status, note: w.review_note, at: w.reviewed_at, seen: w.seen_by_staff })),
    ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

    const unseen = outcomes.filter((o) => !o.seen).length;

    return Response.json({ outcomes, unseen });
  } catch (error) {
    return serverError(error);
  }
}

// Mark outcomes as seen (staff acknowledges they've viewed them).
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const uid = access.user.id;
    const b = await request.json();
    // Mark all the person's decided requests and reviewed forms as seen.
    await Promise.all([
      access.admin.from("service_requests").update({ seen_by_staff: true }).eq("created_by", uid).in("status", ["approved", "declined"]),
      access.admin.from("whs_forms").update({ seen_by_staff: true }).eq("created_by", uid).in("status", ["reviewed", "actioned"]),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
