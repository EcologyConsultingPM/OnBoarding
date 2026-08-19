import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, title, body, category, status, created_by, approved_by, approved_at, published_at, admin_note, created_at, updated_at";

function opt(v) { const t = typeof v === "string" ? v.trim() : ""; return t || null; }

// PATCH drives the controlled workflow. The `action` decides the transition,
// and each action checks the caller's role and the notice's current status so
// an invalid move (e.g. publishing something not yet approved) is rejected.
export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { data: notice } = await access.admin.from("notices").select("id, created_by, status").eq("id", params.noticeId).maybeSingle();
    if (!notice) return Response.json({ error: "Notice not found." }, { status: 404 });

    const isOwner = notice.created_by === access.user.id;
    const body = await request.json();
    const action = body.action;
    let update = null;

    if (action === "edit") {
      if (!isOwner) return Response.json({ error: "You can only edit your own notice." }, { status: 403 });
      if (!["draft", "declined"].includes(notice.status)) return Response.json({ error: "Only draft or declined notices can be edited." }, { status: 409 });
      update = { title: opt(body.title) ?? undefined, body: opt(body.body), category: opt(body.category) };
    } else if (action === "submit") {
      if (!isOwner) return Response.json({ error: "You can only submit your own notice." }, { status: 403 });
      if (!["draft", "declined"].includes(notice.status)) return Response.json({ error: "This notice cannot be submitted from its current state." }, { status: 409 });
      update = { status: "submitted", admin_note: null };
    } else if (action === "approve") {
      if (!access.isAdmin) return Response.json({ error: "Only administrators can approve release." }, { status: 403 });
      if (notice.status !== "submitted") return Response.json({ error: "Only submitted notices can be approved." }, { status: 409 });
      update = { status: "approved", approved_by: access.user.id, approved_at: new Date().toISOString(), admin_note: opt(body.adminNote) };
    } else if (action === "decline") {
      if (!access.isAdmin) return Response.json({ error: "Only administrators can decline release." }, { status: 403 });
      if (notice.status !== "submitted") return Response.json({ error: "Only submitted notices can be declined." }, { status: 409 });
      update = { status: "declined", admin_note: opt(body.adminNote) };
    } else if (action === "publish") {
      // Per the business rule, the AUTHOR publishes once an admin has approved.
      if (!isOwner && !access.isAdmin) return Response.json({ error: "Only the author can publish this notice." }, { status: 403 });
      if (notice.status !== "approved") return Response.json({ error: "This notice must be approved before it can be published." }, { status: 409 });
      update = { status: "published", published_at: new Date().toISOString() };
    } else {
      return Response.json({ error: "Unknown action." }, { status: 400 });
    }

    const { data, error } = await access.admin.from("notices").update(update).eq("id", params.noticeId).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ notice: data });
  } catch (error) {
    return serverError(error);
  }
}

// POST marks the notice as read by the caller (read receipt). Idempotent via
// the unique (notice_id, staff_user_id) constraint.
export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { error } = await access.admin
      .from("notice_receipts")
      .upsert({ notice_id: params.noticeId, staff_user_id: access.user.id }, { onConflict: "notice_id,staff_user_id", ignoreDuplicates: true });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const { data: notice } = await access.admin.from("notices").select("created_by, status").eq("id", params.noticeId).maybeSingle();
    if (!notice) return Response.json({ error: "Notice not found." }, { status: 404 });
    if (!access.isAdmin && (notice.created_by !== access.user.id || notice.status === "published")) {
      return Response.json({ error: "You cannot delete this notice." }, { status: 403 });
    }
    const { error } = await access.admin.from("notices").delete().eq("id", params.noticeId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
