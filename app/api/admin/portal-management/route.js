import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIMARY_ENV = "PRIMARY_ADMIN_EMAIL";
const ROLE_KEYS = new Set([
  "fauna_expert",
  "flora_expert",
  "whs_manager",
  "report_expert",
  "module_assessor",
]);

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validStaffEmail(email) {
  return /^[^\s@]+@ecologyconsulting\.au$/i.test(email);
}

function primaryEmail() {
  return normaliseEmail(process.env[PRIMARY_ENV]);
}

function isPrimary(access) {
  const configured = primaryEmail();
  return Boolean(configured && normaliseEmail(access?.user?.email) === configured);
}

async function listUsers(access) {
  const { data, error } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data?.users || [];
}

function displayName(user) {
  const meta = user?.user_metadata || {};
  const first = String(meta.first_name || meta.firstName || "").trim();
  const last = String(meta.last_name || meta.lastName || "").trim();
  return String(meta.full_name || meta.name || [first, last].filter(Boolean).join(" ") || user?.email || "").trim();
}

async function userForEmail(access, email, users = null) {
  const all = users || await listUsers(access);
  return all.find((candidate) => normaliseEmail(candidate.email) === email) || null;
}

async function primaryUser(access, users = null) {
  const configured = primaryEmail();
  if (!configured) return null;
  return userForEmail(access, configured, users);
}

async function sendPrimaryEvent(access, users, title, body, sourceId) {
  const recipient = await primaryUser(access, users);
  if (!recipient?.id) return;
  const { error } = await access.admin.from("portal_events").insert({
    recipient_id: recipient.id,
    event_type: "admin_access_request",
    severity: "approval",
    title,
    body,
    href: "/?mode=portalmgmt",
    source_table: "admin_access_requests",
    source_id: sourceId || null,
  });
  if (error) console.warn("Could not create primary-admin portal event:", error.message);
}

async function requireAdmin(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  if (!access.isAdmin) return { error: jsonError("Administrator access is required.", 403) };
  return { access };
}

function assignmentColumns() {
  return [
    "id", "target_user_id", "target_email", "role_key", "module_scope", "status",
    "assigned_by", "assigned_at", "withdrawn_by", "withdrawn_at",
  ].join(", ");
}

function requestColumns() {
  return [
    "id", "request_type", "target_email", "reason", "requested_by", "requester_email",
    "status", "decided_by", "decided_at", "decision_note", "created_at", "updated_at",
  ].join(", ");
}

function mapAssignment(row, users) {
  const owner = users.find((user) => user.id === row.target_user_id);
  return {
    id: row.id,
    roleKey: row.role_key,
    moduleScope: row.module_scope || "",
    targetEmail: row.target_email,
    targetName: displayName(owner),
    assignedAt: row.assigned_at,
  };
}

function mapRequest(row) {
  return {
    id: row.id,
    requestType: row.request_type,
    targetEmail: row.target_email,
    reason: row.reason || "",
    requesterEmail: row.requester_email,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function tableUnavailable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}

async function getDashboard(access) {
  const [users, adminResult, roleResult, allRequests] = await Promise.all([
    listUsers(access),
    access.admin.from("admin_emails").select("email").order("email", { ascending: true }),
    access.admin.from("portal_role_assignments").select(assignmentColumns()).eq("status", "active").order("assigned_at", { ascending: false }),
    isPrimary(access)
      ? access.admin.from("admin_access_requests").select(requestColumns()).order("created_at", { ascending: false })
      : access.admin.from("admin_access_requests").select(requestColumns()).eq("requested_by", access.user.id).order("created_at", { ascending: false }),
  ]);

  if (adminResult.error) throw new Error(adminResult.error.message);
  const authoritySchemaReady = !roleResult.error && !allRequests.error;
  if (!authoritySchemaReady && !tableUnavailable(roleResult.error) && !tableUnavailable(allRequests.error)) {
    throw new Error(roleResult.error?.message || allRequests.error?.message || "Could not load authority controls.");
  }

  return {
    primaryEmail: primaryEmail() || null,
    primaryConfigured: Boolean(primaryEmail()),
    authoritySchemaReady,
    isPrimary: isPrimary(access),
    adminEmails: (adminResult.data || []).map((row) => normaliseEmail(row.email)),
    staff: users
      .filter((user) => validStaffEmail(normaliseEmail(user.email)))
      .map((user) => ({ id: user.id, email: normaliseEmail(user.email), name: displayName(user) }))
      .sort((left, right) => left.name.localeCompare(right.name, "en-AU")),
    roleAssignments: authoritySchemaReady ? (roleResult.data || []).map((row) => mapAssignment(row, users)) : [],
    accessRequests: authoritySchemaReady ? (allRequests.data || []).map(mapRequest) : [],
  };
}

export async function GET(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    return Response.json(await getDashboard(auth.access));
  } catch (error) {
    return serverError(error);
  }
}

async function grantAdmin(access, targetEmail) {
  if (!isPrimary(access)) return jsonError("Only the configured primary administrator can grant administrator access.", 403);
  if (!validStaffEmail(targetEmail)) return jsonError("Enter a valid Ecology Consulting email address.");
  if (targetEmail === primaryEmail()) return jsonError("The primary administrator already has protected administrator access.");

  const target = await userForEmail(access, targetEmail);
  if (!target) return jsonError("Create the staff account before granting administrator access.", 404);

  const { error } = await access.admin.from("admin_emails").upsert({
    email: targetEmail,
    added_by: normaliseEmail(access.user.email),
  }, { onConflict: "email" });
  if (error) return jsonError(error.message);
  return Response.json({ granted: true, targetEmail });
}

async function removeAdmin(access, targetEmail) {
  if (!isPrimary(access)) return jsonError("Only the configured primary administrator can remove administrator access.", 403);
  if (!validStaffEmail(targetEmail)) return jsonError("Enter a valid Ecology Consulting email address.");
  if (targetEmail === primaryEmail()) return jsonError("The protected primary administrator cannot be removed through the portal.", 403);

  const { data: records, error: listError } = await access.admin.from("admin_emails").select("email").order("email", { ascending: true });
  if (listError) return jsonError(listError.message);
  if ((records || []).length <= 1) return jsonError("At least one administrator must remain assigned.", 409);

  const { error } = await access.admin.from("admin_emails").delete().eq("email", targetEmail);
  if (error) return jsonError(error.message);
  return Response.json({ removed: true, targetEmail });
}

async function createAdminRequest(access, body) {
  if (isPrimary(access)) return jsonError("You can change administrator access directly as the primary administrator.", 409);

  const targetEmail = normaliseEmail(body.targetEmail);
  const requestType = String(body.requestType || "").trim();
  const reason = String(body.reason || "").trim().slice(0, 1000);
  if (!validStaffEmail(targetEmail)) return jsonError("Enter a valid Ecology Consulting email address.");
  if (!new Set(["grant", "remove"]).has(requestType)) return jsonError("Administrator-access requests must be a grant or removal request.");
  if (targetEmail === primaryEmail()) return jsonError("The protected primary administrator cannot be changed through a request.", 403);

  const { data: existing, error: existingError } = await access.admin
    .from("admin_access_requests")
    .select("id")
    .eq("target_email", targetEmail)
    .eq("request_type", requestType)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existingError) return jsonError(existingError.message);
  if (existing) return jsonError("A matching administrator-access request is already awaiting review.", 409);

  const { data, error } = await access.admin.from("admin_access_requests").insert({
    request_type: requestType,
    target_email: targetEmail,
    reason: reason || null,
    requested_by: access.user.id,
    requester_email: normaliseEmail(access.user.email),
    status: "pending",
  }).select("id").single();
  if (error) return jsonError(error.message);

  const users = await listUsers(access);
  await sendPrimaryEvent(
    access,
    users,
    "Administrator-access request awaiting review",
    `${normaliseEmail(access.user.email)} requested to ${requestType} administrator access for ${targetEmail}.`,
    data.id,
  );
  return Response.json({ requested: true, id: data.id }, { status: 201 });
}

async function decideAdminRequest(access, body) {
  if (!isPrimary(access)) return jsonError("Only the configured primary administrator can decide administrator-access requests.", 403);
  const requestId = String(body.requestId || "").trim();
  const decision = String(body.decision || "").trim();
  const decisionNote = String(body.decisionNote || "").trim().slice(0, 1000);
  if (!requestId) return jsonError("Request ID is required.");
  if (!new Set(["approved", "rejected"]).has(decision)) return jsonError("Decision must be approved or rejected.");

  const { data: pending, error: lookupError } = await access.admin
    .from("admin_access_requests")
    .select(requestColumns())
    .eq("id", requestId)
    .eq("status", "pending")
    .maybeSingle();
  if (lookupError) return jsonError(lookupError.message);
  if (!pending) return jsonError("The access request is no longer awaiting review.", 404);

  if (decision === "approved") {
    const response = pending.request_type === "grant"
      ? await grantAdmin(access, normaliseEmail(pending.target_email))
      : await removeAdmin(access, normaliseEmail(pending.target_email));
    if (!response.ok) return response;
  }

  const { error } = await access.admin.from("admin_access_requests").update({
    status: decision,
    decided_by: access.user.id,
    decided_at: new Date().toISOString(),
    decision_note: decisionNote || null,
    updated_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "pending");
  if (error) return jsonError(error.message);
  return Response.json({ decided: true, decision });
}

async function assignRole(access, body) {
  const targetEmail = normaliseEmail(body.targetEmail);
  const roleKey = String(body.roleKey || "").trim();
  const moduleScope = roleKey === "module_assessor" ? String(body.moduleScope || "").trim().slice(0, 250) : null;
  if (!validStaffEmail(targetEmail)) return jsonError("Enter a valid Ecology Consulting email address.");
  if (!ROLE_KEYS.has(roleKey)) return jsonError("That specialist role is not recognised.");
  if (roleKey === "module_assessor" && !moduleScope) return jsonError("A module assessor requires a module or programme scope.");

  const target = await userForEmail(access, targetEmail);
  if (!target) return jsonError("Create the staff account before allocating a specialist role.", 404);

  let existingQuery = access.admin
    .from("portal_role_assignments")
    .select("id")
    .eq("target_user_id", target.id)
    .eq("role_key", roleKey)
    .eq("status", "active");
  existingQuery = moduleScope ? existingQuery.eq("module_scope", moduleScope) : existingQuery.is("module_scope", null);
  const { data: existing, error: existingError } = await existingQuery.limit(1).maybeSingle();
  if (existingError) return jsonError(existingError.message);
  if (existing) return jsonError("This active specialist allocation already exists.", 409);

  const { error } = await access.admin.from("portal_role_assignments").insert({
    target_user_id: target.id,
    target_email: targetEmail,
    role_key: roleKey,
    module_scope: moduleScope || null,
    status: "active",
    assigned_by: access.user.id,
    assigned_at: new Date().toISOString(),
  });
  if (error) return jsonError(error.message);
  return Response.json({ assigned: true });
}

async function removeRole(access, body) {
  const assignmentId = String(body.assignmentId || "").trim();
  if (!assignmentId) return jsonError("Role assignment ID is required.");
  const { data, error } = await access.admin.from("portal_role_assignments").update({
    status: "withdrawn",
    withdrawn_by: access.user.id,
    withdrawn_at: new Date().toISOString(),
  }).eq("id", assignmentId).eq("status", "active").select("id").maybeSingle();
  if (error) return jsonError(error.message);
  if (!data) return jsonError("The specialist role is no longer active.", 404);
  return Response.json({ withdrawn: true, id: assignmentId });
}

export async function POST(request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const action = String(body?.action || "").trim();

    if (action === "grant_admin") return grantAdmin(auth.access, normaliseEmail(body.targetEmail));
    if (action === "remove_admin") return removeAdmin(auth.access, normaliseEmail(body.targetEmail));
    if (action === "request_admin_access") return createAdminRequest(auth.access, body);
    if (action === "decide_admin_access_request") return decideAdminRequest(auth.access, body);
    if (action === "assign_role") return assignRole(auth.access, body);
    if (action === "remove_role") return removeRole(auth.access, body);
    return jsonError("This Portal Management action is not recognised.");
  } catch (error) {
    return serverError(error);
  }
}
