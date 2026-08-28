import { requireSession, serverError } from "../../../lib/serverAuth";
import { listDirectoryUsers, normaliseStaffEmail } from "../../../lib/staffDirectory";
import {
  PORTAL_RESOURCES,
  isPrimaryAdministrator,
  resourceDefinition,
  visibilityForUser,
  visibilitySchemaMissing,
} from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function primaryOnly(access) {
  if (isPrimaryAdministrator(access)) return null;
  return Response.json(
    { error: "Only Aaron Dooley can change staff portal visibility." },
    { status: 403 },
  );
}

function requestedResources(value) {
  if (!value) return PORTAL_RESOURCES.map((resource) => resource.key);
  return String(value)
    .split(",")
    .map((key) => key.trim())
    .filter((key) => resourceDefinition(key));
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
      staff.map(async (person) => ({
        ...person,
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
    if (normaliseStaffEmail(recipient.email) === "aaron.dooley@ecologyconsulting.au") {
      return Response.json(
        { error: "The primary administrator always retains portal access." },
        { status: 400 },
      );
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
