import { requireSession, serverError } from "../../../lib/serverAuth";

import { listDirectoryUsers } from "../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = [
  "id", "created_by", "assigned_to", "project", "task", "due_date", "budget_hours",
  "deliverable", "resources", "notes", "status", "staff_note", "review_note",
  "accepted_at", "declined_at", "decline_reason", "submitted_at", "completed_at",
  "withdrawn_at", "seen_by_staff", "created_at", "updated_at",
].join(", ");

const STAFF_ACTIVE_STATES = ["accepted", "in_progress", "submitted", "revising"];

function badRequest(error) {
  return Response.json({ error }, { status: 400 });
}

// Events are stored for the in-portal Staff Noticeboard. A task mutation remains
// successful even if event creation reports a warning, avoiding duplicate tasks
// when a transient notification failure is retried by the administrator.
async function createPortalEvent(admin, values) {
  const { error } = await admin.from("portal_events").insert(values);
  return error ? error.message : null;
}

// GET: staff receive only tasks assigned to them; administrators receive all tasks
// and a staff directory for assignment. The existing portal calendar derives its
// accepted-task deadline entries from this protected response.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    let query = access.admin
      .from("remote_tasks")
      .select(COLS)
      .order("due_date", { ascending: true, nullsFirst: false });

    if (!access.isAdmin) query = query.eq("assigned_to", access.user.id);

    const { data, error } = await query;
    if (error) return badRequest(error.message);

    let tasks = data || [];
    let staff = [];
    if (tasks.length || access.isAdmin) {
      const { data: usersData } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const users = usersData?.users || [];
      const nameById = new Map(users.map((u) => [u.id, u.user_metadata?.full_name || u.email]));
      tasks = tasks.map((task) => ({
        ...task,
        assignee: nameById.get(task.assigned_to) || "Unknown",
        assigner: nameById.get(task.created_by) || null,
      }));
      if (access.isAdmin) {
        // Assignment choices are sourced only from the controlled Staff List.
        staff = await listDirectoryUsers(access.admin, { activeOnly: true });
      }
    }

    const pendingAcceptanceCount = access.isAdmin
      ? tasks.filter((task) => task.status === "awaiting_acceptance").length
      : tasks.filter((task) => task.status === "awaiting_acceptance" && !task.seen_by_staff).length;

    return Response.json({ tasks, staff, isAdmin: access.isAdmin, pendingAcceptanceCount });
  } catch (error) {
    return serverError(error);
  }
}

// POST: only administrators can issue an allocation. It deliberately starts in
// awaiting_acceptance, so no entry appears on the staff in-portal calendar yet.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Only administrators can assign tasks." }, { status: 403 });

    const body = await request.json();
    if (!body.assigned_to) return badRequest("Choose a staff member to assign.");
    const directory = await listDirectoryUsers(access.admin, { activeOnly: true });
    if (!directory.some((person) => person.id === body.assigned_to)) return badRequest("Choose an available staff member from the Staff List.");
    if (!body.project || !body.project.trim()) return badRequest("Project is required.");
    if (!body.task || !body.task.trim()) return badRequest("Task description is required.");

    const { data, error } = await access.admin
      .from("remote_tasks")
      .insert({
        created_by: access.user.id,
        assigned_to: body.assigned_to,
        project: body.project.trim(),
        task: body.task.trim(),
        due_date: body.due_date || null,
        budget_hours: body.budget_hours ? Number(body.budget_hours) : null,
        deliverable: (body.deliverable || "").trim() || null,
        resources: (body.resources || "").trim() || null,
        notes: (body.notes || "").trim() || null,
        status: "awaiting_acceptance",
      })
      .select(COLS)
      .single();

    if (error) return badRequest(error.message);
    const eventWarning = await createPortalEvent(access.admin, {
      recipient_id: data.assigned_to,
      event_type: "remote_task_assigned",
      severity: "action_required",
      title: "New Remote Task awaiting acceptance",
      body: `${data.project}: ${data.task}${data.due_date ? ` · Due ${new Date(data.due_date).toLocaleDateString("en-AU")}` : ""}`,
      href: "/staff/notifications",
      source_table: "remote_tasks",
      source_id: data.id,
    });
    return Response.json({ task: data, event_warning: eventWarning || null }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: the assignee accepts, asks a question, declines, starts and submits work.
// Administrators review, request revision and complete. Accepted task deadlines are
// rendered automatically in the in-portal staff calendar by the StaffHome component.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const body = await request.json();
    if (!body.id) return badRequest("Task id required.");

    const { data: existing, error: lookupError } = await access.admin
      .from("remote_tasks")
      .select("id, assigned_to, created_by, status, project, task")
      .eq("id", body.id)
      .maybeSingle();

    if (lookupError) return badRequest(lookupError.message);
    if (!existing) return Response.json({ error: "Task not found." }, { status: 404 });

    const isAssignee = existing.assigned_to === access.user.id;
    if (!isAssignee && !access.isAdmin) {
      return Response.json({ error: "You do not have access to this task." }, { status: 403 });
    }

    const values = {};
    const now = new Date().toISOString();

    // Assignee actions. A task must be accepted before it can begin or be submitted.
    if (isAssignee) {
      if (body.action === "seen") values.seen_by_staff = true;

      if (body.action === "accept") {
        if (existing.status !== "awaiting_acceptance") return badRequest("This task is no longer awaiting acceptance.");
        values.status = "accepted";
        values.accepted_at = now;
        values.declined_at = null;
        values.decline_reason = null;
        values.seen_by_staff = true;
      }

      if (body.action === "decline") {
        if (existing.status !== "awaiting_acceptance") return badRequest("Only tasks awaiting acceptance can be declined.");
        const reason = (body.decline_reason || "").trim();
        if (!reason) return badRequest("Please provide a reason or reassignment request.");
        values.status = "declined";
        values.declined_at = now;
        values.decline_reason = reason;
        values.staff_note = reason;
        values.seen_by_staff = true;
      }

      if (body.action === "start") {
        if (!["accepted", "revising"].includes(existing.status)) return badRequest("Accept the task before starting work.");
        values.status = "in_progress";
      }

      if (body.action === "submit") {
        if (!["accepted", "in_progress", "revising"].includes(existing.status)) return badRequest("Accept the task before submitting work.");
        values.status = "submitted";
        values.submitted_at = now;
      }

      if (typeof body.staff_note === "string") {
        values.staff_note = body.staff_note.trim() || null;
      }
    }

    // Administrator review actions. A withdrawn task is retained for audit history.
    if (access.isAdmin) {
      if (body.action === "revise") {
        if (existing.status !== "submitted") return badRequest("Only submitted tasks can be returned for revision.");
        values.status = "revising";
      }
      if (body.action === "complete") {
        if (existing.status !== "submitted") return badRequest("Only submitted tasks can be marked complete.");
        values.status = "complete";
        values.completed_at = now;
      }
      if (body.action === "withdraw") {
        if (["complete", "withdrawn"].includes(existing.status)) return badRequest("This task can no longer be withdrawn.");
        values.status = "withdrawn";
        values.withdrawn_at = now;
      }
      if (typeof body.review_note === "string") {
        values.review_note = body.review_note.trim() || null;
      }
    }

    if (!Object.keys(values).length) return badRequest("Nothing to update.");

    const { data, error } = await access.admin
      .from("remote_tasks")
      .update(values)
      .eq("id", existing.id)
      .select(COLS)
      .single();

    if (error) return badRequest(error.message);

    if (body.action === "accept") {
      // The pending notice has served its purpose. Retain the event for audit,
      // but clear it from the unread badge as work moves into My Projects.
      await access.admin.from("portal_events")
        .update({ read_at: now })
        .eq("recipient_id", access.user.id)
        .eq("source_table", "remote_tasks")
        .eq("source_id", existing.id)
        .is("read_at", null);
    }

    const patchEvent = {
      accept: { recipient: existing.created_by, type: "remote_task_accepted", severity: "information", title: "Remote Task accepted", body: `${existing.project}: ${existing.task} has been accepted.` },
      decline: { recipient: existing.created_by, type: "remote_task_declined", severity: "action_required", title: "Remote Task declined / reassignment requested", body: `${existing.project}: ${existing.task}${values.decline_reason ? ` · ${values.decline_reason}` : ""}` },
      submit: { recipient: existing.created_by, type: "remote_task_submitted", severity: "review", title: "Remote Task ready for review", body: `${existing.project}: ${existing.task} has been submitted.` },
      revise: { recipient: existing.assigned_to, type: "remote_task_revision", severity: "action_required", title: "Remote Task returned for revision", body: `${existing.project}: ${existing.task}${values.review_note ? ` · ${values.review_note}` : ""}` },
      complete: { recipient: existing.assigned_to, type: "remote_task_completed", severity: "information", title: "Remote Task completed", body: `${existing.project}: ${existing.task} has been marked complete.` },
      withdraw: { recipient: existing.assigned_to, type: "remote_task_withdrawn", severity: "information", title: "Remote Task withdrawn", body: `${existing.project}: ${existing.task} has been withdrawn.` },
    }[body.action];

    const eventWarning = patchEvent ? await createPortalEvent(access.admin, {
      recipient_id: patchEvent.recipient,
      event_type: patchEvent.type,
      severity: patchEvent.severity,
      title: patchEvent.title,
      body: patchEvent.body,
      href: patchEvent.recipient === existing.assigned_to ? "/staff/projects" : "/staff/notifications",
      source_table: "remote_tasks",
      source_id: existing.id,
    }) : null;

    return Response.json({ task: data, event_warning: eventWarning || null });
  } catch (error) {
    return serverError(error);
  }
}

// DELETE is maintained for the existing UI, but withdraws rather than destroys a
// task so accepted allocations remain auditable.
export async function DELETE(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return badRequest("Task id required.");

    const { data, error } = await access.admin
      .from("remote_tasks")
      .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
      .eq("id", id)
      .not("status", "in", "(complete,withdrawn)")
      .select(COLS)
      .maybeSingle();

    if (error) return badRequest(error.message);
    if (!data) return badRequest("Task cannot be withdrawn because it is already complete or withdrawn.");
    const eventWarning = await createPortalEvent(access.admin, {
      recipient_id: data.assigned_to,
      event_type: "remote_task_withdrawn",
      severity: "information",
      title: "Remote Task withdrawn",
      body: `${data.project}: ${data.task} has been withdrawn.`,
      href: "/staff/remote-operations",
      source_table: "remote_tasks",
      source_id: data.id,
    });
    return Response.json({ task: data, event_warning: eventWarning || null });
  } catch (error) {
    return serverError(error);
  }
}
