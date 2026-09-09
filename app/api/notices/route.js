import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, title, body, category, status, created_by, approved_by, approved_at, published_at, admin_note, created_at, updated_at";

function opt(v) { const t = typeof v === "string" ? v.trim() : ""; return t || null; }

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    // RLS returns: published (everyone) + own (author) + all (admin).
    const { data, error } = await access.admin.from("notices").select(COLUMNS).order("updated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const notices = data || [];

    // Attach author emails + (for admin) read-receipt counts.
    const { data: usersData } = await access.admin.auth.admin.listUsers();
    const emailById = new Map((usersData?.users || []).map((u) => [u.id, u.email]));

    let receiptCounts = new Map();
    if (access.isAdmin) {
      const publishedIds = notices.filter((n) => n.status === "published").map((n) => n.id);
      if (publishedIds.length) {
        const { data: receipts } = await access.admin.from("notice_receipts").select("notice_id").in("notice_id", publishedIds);
        for (const r of receipts || []) receiptCounts.set(r.notice_id, (receiptCounts.get(r.notice_id) || 0) + 1);
      }
    }

    const enriched = notices.map((n) => ({
      ...n,
      author_email: emailById.get(n.created_by) || null,
      read_count: access.isAdmin ? (receiptCounts.get(n.id) || 0) : undefined,
    }));

    return Response.json({ notices: enriched, isAdmin: access.isAdmin, userId: access.user.id });
  } catch (error) {
    return serverError(error);
  }
}

// Create a notice. `submit: true` sends it straight for admin review.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2) return Response.json({ error: "A title is required." }, { status: 400 });

    const { data, error } = await access.admin
      .from("notices")
      .insert({
        created_by: access.user.id,
        title,
        body: opt(body.body),
        category: opt(body.category),
        status: body.submit ? "submitted" : "draft",
      })
      .select(COLUMNS)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ notice: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
