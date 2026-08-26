import { createClient } from "@supabase/supabase-js";

// See app/api/flora-photos/route.js for the auth-pattern note.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getRequestUser(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { user: null, isAdmin: false };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { user: null, isAdmin: false };
  const email = (data.user.email || "").toLowerCase();
  const { data: adminRow } = await supabase
    .from("admin_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return { user: data.user, isAdmin: !!adminRow };
}

// PATCH — Flora expert (admin) verifies or rejects a submission.
export async function PATCH(req, { params }) {
  const { id } = params;
  const { user, isAdmin } = await getRequestUser(req);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!isAdmin) return Response.json({ error: "Flora expert (admin) access required" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { status, review_note } = body || {};
  if (!["verified", "rejected"].includes(status)) {
    return Response.json({ error: "status must be verified or rejected" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("fauna_photo_submissions")
    .update({
      status,
      review_note: review_note || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ submission: data });
}

// DELETE — the submitter can withdraw their own photo while it's still
// pending; an admin can remove any submission.
export async function DELETE(req, { params }) {
  const { id } = params;
  const { user, isAdmin } = await getRequestUser(req);
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: existing, error: fetchErr } = await supabase
    .from("fauna_photo_submissions")
    .select("submitted_by, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const ownsAndPending = existing.submitted_by === user.id && existing.status === "pending";
  if (!isAdmin && !ownsAndPending) {
    return Response.json({ error: "You can only remove your own pending submissions" }, { status: 403 });
  }

  const { error } = await supabase.from("fauna_photo_submissions").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
