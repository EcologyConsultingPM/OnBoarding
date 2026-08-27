import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, created_by, assigned_to, project, task, due_date, budget_hours, deliverable, resources, notes, status, staff_note, review_note, submitted_at, completed_at, seen_by_staff, created_at, updated_at";

// GET: staff see tasks assigned to them; admins see all (with assignee names).
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let query = access.admin.from("remote_tasks").select(COLS).order("due_date", { ascending: true, nullsFirst: false });
    if (!access.isAdmin) query = query.eq("assigned_to", access.user.id);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    let rows = data || [];

    // Attach assignee + assigner emails for the admin view and staff directory.
    let staff = [];
    if (rows.length || access.isAdmin) {
      const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const users = usersData?.users || [];
      const nameById = new Map(users.map((u) => [u.id, u.user_metadata?.full_name || u.email]));
      rows = rows.map((r) => ({ ...r, assignee: nameById.get(r.assigned_to) || "Unknown", assigner: nameById.get(r.created_by) || null }));
      if (access.isAdmin) {
        staff = users.map((u) => ({ id: u.id, name: u.user_metadata?.full_name || u.email, email: u.email }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return Response.json({ tasks: rows, isAdmin: access.isAdmin, staff });
  } catch (error) {
    return serverError(error);
  }
}

// POST: admin/SE assigns a Task Brief to a staff member.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can assign tasks." }, { status: 403 });
    const b = await request.json();
    if (!b.assigned_to) return Response.json({ error: "Choose a staff member to assign." }, { status: 400 });
    if (!b.project || !b.project.trim()) return Response.json({ error: "Project is required." }, { status: 400 });
    if (!b.task || !b.task.trim()) return Response.json({ error: "Task description is required." }, { status: 400 });

    const { data, error } = await access.admin.from("remote_tasks").insert({
      created_by: access.user.id,
      assigned_to: b.assigned_to,
      project: b.project.trim(),
      task: b.task.trim(),
      due_date: b.due_date || null,
      budget_hours: b.budget_hours ? Number(b.budget_hours) : null,
      deliverable: (b.deliverable || "").trim() || null,
      resources: (b.resources || "").trim() || null,
      notes: (b.notes || "").trim() || null,
      status: "assigned",
    }).select(COLS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ task: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: assignee progresses/submits; admin reviews/closes/requests revision.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const b = await request.json();
    if (!b.id) return Response.json({ error: "Task id required." }, { status: 400 });

    const { data: existing } = await access.admin.from("remote_tasks").select("id, assigned_to, created_by").eq("id", b.id).maybeSingle();
    if (!existing) return Response.json({ error: "Task not found." }, { status: 404 });
    const isAssignee = existing.assigned_to === access.user.id;
    if (!isAssignee && !access.isAdmin) return Response.json({ error: "You do not have access to this task." }, { status: 403 });

    const values = {};
    // Staff actions.
    if (isAssignee) {
      if (b.action === "start") values.status = "in_progress";
      if (b.action === "submit") { values.status = "submitted"; values.submitted_at = new Date().toISOString(); }
      if (typeof b.staff_note === "string") values.staff_note = b.staff_note.trim() || null;
      if (b.action === "seen") values.seen_by_staff = true;
    }
    // Admin/SE review actions.
    if (access.isAdmin) {
      if (b.action === "revise") { values.status = "revising"; }
      if (b.action === "complete") { values.status = "complete"; values.completed_at = new Date().toISOString(); }
      if (typeof b.review_note === "string") values.review_note = b.review_note.trim() || null;
    }
    if (!Object.keys(values).length) return Response.json({ error: "Nothing to update." }, { status: 400 });

    const { data, error } = await access.admin.from("remote_tasks").update(values).eq("id", b.id).select(COLS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ task: data });
  } catch (error) {
    return serverError(error);
  }
}

// DELETE: admin withdraws a task.
export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Task id required." }, { status: 400 });
    const { error } = await access.admin.from("remote_tasks").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
