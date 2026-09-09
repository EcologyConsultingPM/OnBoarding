import { requireSession, serverError } from "../../../lib/serverAuth";
import { listDirectoryUsers, normaliseStaffEmail } from "../../../lib/staffDirectory";
import {
  PORTAL_RESOURCES,
  PRIMARY_ADMIN_EMAILS,
  isPrimaryAdministrator,
  resourceDefinition,
  visibilityForUser,
  visibilitySchemaMissing,
  isAlwaysVisibleStaffResource,
} from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function primaryOnly(access) {
  if (isPrimaryAdministrator(access)) return null;
  return Response.json(
    { error: "Only Aaron Dooley or Tony Webster can change portal visibility." },
    { status: 403 },
  );
}

function requestedResources(value) {
  if (!value) return PORTAL_RESOURCES.map((resource) => resource.key);
  const requested = String(value)
    .split(",")
    .map((key) => key.trim())
    .flatMap((key) => ["staff", "admin", "all"].includes(key) ? PORTAL_RESOURCES.filter((resource) => key === "all" || resource.portal === key).map((resource) => resource.key) : [key])
    .filter((key) => resourceDefinition(key));
  const roots = new Set(requested);
  return PORTAL_RESOURCES
    .filter((resource) => roots.has(resource.key) || (resource.parent && roots.has(resource.parent)))
    .map((resource) => resource.key);
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "me";
    const keys = requestedResources(searchParams.get("resources"));

    if (scope === "me") {
      const visibility = await visibilityForUser(access, keys);
      return Response.json({ visibility, primary: isPrimaryAdministrator(access) });
    }

    const denied = primaryOnly(access);
    if (denied) return denied;
    if (scope !== "manage") {
      return Response.json({ error: "Unknown visibility scope." }, { status: 400 });
    }

    const staff = await listDirectoryUsers(access.admin, { activeOnly: true });
    const managesAdminResources = keys.some((key) => resourceDefinition(key)?.portal === "admin");
    let eligibleStaff = staff;
    if (managesAdminResources) {
      const { data: adminRows, error: adminError } = await access.admin
        .from("admin_emails")
        .select("email");
      if (adminError) return Response.json({ error: adminError.message }, { status: 400 });
      const administratorEmails = new Set((adminRows || []).map((row) => normaliseStaffEmail(row.email)));
      PRIMARY_ADMIN_EMAILS.forEach((email) => administratorEmails.add(email));
      eligibleStaff = staff.filter((person) => administratorEmails.has(normaliseStaffEmail(person.email)));
    }
    const { data, error } = await access.admin
      .from("portal_visibility_overrides")
      .select("user_id, resource_key, is_visible, updated_at")
      .in("resource_key", keys);
    if (error) {
      if (visibilitySchemaMissing(error)) {
        return Response.json(
          {
            error:
              "Visibility controls are ready in the review build but have not been activated in the database yet.",
            migrationRequired: true,
          },
          { status: 503 },
        );
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    const rowsByUser = new Map();
    for (const row of data || []) {
      if (!rowsByUser.has(row.user_id)) rowsByUser.set(row.user_id, {});
      rowsByUser.get(row.user_id)[row.resource_key] = row.is_visible;
    }
    const people = await Promise.all(
      eligibleStaff.map(async (person) => ({
        ...person,
        isPrimary: PRIMARY_ADMIN_EMAILS.includes(normaliseStaffEmail(person.email)),
        visibility: await visibilityForUser(
          { ...access, user: { ...access.user, id: person.id, email: person.email } },
          keys,
        ),
        overrides: rowsByUser.get(person.id) || {},
      })),
    );
    return Response.json({ resources: PORTAL_RESOURCES, staff: people });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = primaryOnly(access);
    if (denied) return denied;

    const body = await request.json();
    const userId = String(body?.userId || "").trim();
    const resourceKey = String(body?.resourceKey || "").trim();
    const isVisible = body?.isVisible;
    if (!userId || !resourceDefinition(resourceKey) || typeof isVisible !== "boolean") {
      return Response.json({ error: "Choose a staff member, portal area and visibility setting." }, { status: 400 });
    }

    const activeStaff = await listDirectoryUsers(access.admin, { activeOnly: true });
    const recipient = activeStaff.find((person) => person.id === userId);
    if (!recipient) {
      return Response.json({ error: "Visibility can be changed only for an active Staff List member." }, { status: 400 });
    }
    if (PRIMARY_ADMIN_EMAILS.includes(normaliseStaffEmail(recipient.email))) {
      return Response.json(
        { error: "Protected administrators always retain portal access." },
        { status: 400 },
      );
    }
    const resource = resourceDefinition(resourceKey);
    if (isAlwaysVisibleStaffResource(resourceKey)) {
      return Response.json(
        { error: "WHS & EC Forms are available to all active staff and cannot be locked." },
        { status: 400 },
      );
    }
    if (resource?.portal === "admin") {
      const { data: adminRows, error: adminError } = await access.admin
        .from("admin_emails")
        .select("email");
      if (adminError) return Response.json({ error: adminError.message }, { status: 400 });
      const administratorEmails = new Set((adminRows || []).map((row) => normaliseStaffEmail(row.email)));
      if (!administratorEmails.has(normaliseStaffEmail(recipient.email))) {
        return Response.json(
          { error: "Admin portal visibility can only be granted to an active administrator." },
          { status: 400 },
        );
      }
    }

    const { error } = await access.admin.from("portal_visibility_overrides").upsert(
      {
        user_id: userId,
        resource_key: resourceKey,
        is_visible: isVisible,
        updated_by: access.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,resource_key" },
    );
    if (error) {
      if (visibilitySchemaMissing(error)) {
        return Response.json(
          {
            error:
              "Visibility controls have not been activated in the database yet.",
            migrationRequired: true,
          },
          { status: 503 },
        );
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    const visibility = await visibilityForUser(
      { ...access, user: { ...access.user, id: recipient.id, email: recipient.email } },
      [resourceKey],
    );
    return Response.json({ ok: true, staff: recipient, visibility });
  } catch (error) {
    return serverError(error);
  }
}
