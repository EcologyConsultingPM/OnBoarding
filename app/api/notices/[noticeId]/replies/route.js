import { requireSession, serverError } from "../../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

async function noticeForReply(access, noticeId) {
  const { data, error } = await access.admin
    .from("notices")
    .select("id, status, created_by")
    .eq("id", noticeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: Response.json({ error: "Notice not found." }, { status: 404 }) };
  if (data.status !== "published" && !access.isAdmin && data.created_by !== access.user.id) {
    return { error: Response.json({ error: "This notice is not available for discussion." }, { status: 403 }) };
  }
  return { notice: data };
}

async function authorEmailMap(access) {
  const { data, error } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return new Map((data?.users || []).map((user) => [user.id, user.email]));
}

export async function GET(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const gate = await noticeForReply(access, params.noticeId);
    if (gate.error) return gate.error;

    const { data, error } = await access.admin
      .from("notice_replies")
      .select("id, notice_id, author_id, body, created_at, updated_at")
      .eq("notice_id", params.noticeId)
      .order("created_at", { ascending: true });
    if (error) {
      if (tableUnavailable(error)) return Response.json({ replies: [], migrationRequired: true });
      return Response.json({ error: error.message }, { status: 400 });
    }
    const emailById = await authorEmailMap(access);
    return Response.json({
      replies: (data || []).map((reply) => ({
        ...reply,
        author_email: emailById.get(reply.author_id) || null,
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const gate = await noticeForReply(access, params.noticeId);
    if (gate.error) return gate.error;
    if (gate.notice.status !== "published") {
      return Response.json({ error: "Replies can be added after a notice is published." }, { status: 409 });
    }

    const body = await request.json();
    const reply = String(body?.body || "").trim();
    if (!reply) return Response.json({ error: "Write a reply before posting." }, { status: 400 });
    if (reply.length > 4000) return Response.json({ error: "Replies must be 4,000 characters or fewer." }, { status: 400 });

    const { data, error } = await access.admin
      .from("notice_replies")
      .insert({ notice_id: params.noticeId, author_id: access.user.id, body: reply })
      .select("id, notice_id, author_id, body, created_at, updated_at")
      .single();
    if (error) {
      if (tableUnavailable(error)) return Response.json({ error: "Noticeboard replies are awaiting the approved database migration." }, { status: 409 });
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({
      reply: { ...data, author_email: access.user.email || null },
    }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
