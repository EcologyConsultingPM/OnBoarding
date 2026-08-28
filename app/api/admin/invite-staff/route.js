import { randomBytes } from "crypto";
import { requireSession, serverError } from "../../../../lib/serverAuth";
import { PORTAL_RESOURCES, visibilitySchemaMissing } from "../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIMARY_ENV = "PRIMARY_ADMIN_EMAIL";

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function primaryEmail() {
  return normaliseEmail(process.env[PRIMARY_ENV]);
}

function primaryAccess(access) {
  const configured = primaryEmail();
  return Boolean(configured && normaliseEmail(access?.user?.email) === configured);
}

function validStaffEmail(email) {
  return /^[^\s@]+@ecologyconsulting\.au$/i.test(email);
}

function safeName(value, maximum = 100) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function safePhone(value) {
  return String(value || "").trim().replace(/[^0-9+()\-\s]/g, "").slice(0, 32);
}

function createTemporaryPassword() {
  // A URL-safe random password with enough entropy for a single-use credential.
  return `${randomBytes(12).toString("base64url")}Ec!`;
}

const STAFF_RESOURCE_KEYS = PORTAL_RESOURCES.filter(
  (resource) => resource.portal === "staff",
).map((resource) => resource.key);

function selectedStaffResourceKeys(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((key) => String(key || "").trim()))].filter(
    (key) => STAFF_RESOURCE_KEYS.includes(key),
  );
}

function staffResourceIsSelected(resourceKey, selectedKeys) {
  const resource = PORTAL_RESOURCES.find((item) => item.key === resourceKey);
  return Boolean(
    selectedKeys.includes(resourceKey) ||
      (resource?.parent && selectedKeys.includes(resource.parent)),
  );
}

async function matchingUser(access, email) {
  const { data, error } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return (data?.users || []).find((candidate) => normaliseEmail(candidate.email) === email) || null;
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrator access is required.", 403);

    const body = await request.json();
    const email = normaliseEmail(body?.email);
    const firstName = safeName(body?.firstName);
    const lastName = safeName(body?.lastName);
    const phone = safePhone(body?.phone);
    const accessLevel = String(body?.accessLevel || "staff").trim();
    const forceChange = body?.forceChange !== false;
    const requestedStaffResources = selectedStaffResourceKeys(body?.visibleStaffResources);

    if (!validStaffEmail(email)) return jsonError("Email must be an @ecologyconsulting.au address.");
    if (!firstName) return jsonError("First name is required.");
    if (!["staff", "admin", "both"].includes(accessLevel)) return jsonError("Choose a valid portal access level.");

    const needsAdminAccess = accessLevel === "admin" || accessLevel === "both";
    if (needsAdminAccess && !primaryAccess(access)) {
      return jsonError("Only the configured primary administrator can grant administrator access.", 403);
    }
    if (needsAdminAccess && !primaryEmail()) {
      return jsonError("Primary administrator protection is not configured. Administrator access cannot be granted.", 503);
    }
    if (requestedStaffResources && !primaryAccess(access)) {
      return jsonError("Only Aaron Dooley can set staff domain visibility during account setup.", 403);
    }

    const temporaryPassword = createTemporaryPassword();
    const existing = await matchingUser(access, email);
    const profile = {
      ...(existing?.user_metadata || {}),
      first_name: firstName,
      last_name: lastName,
      full_name: [firstName, lastName].filter(Boolean).join(" "),
      phone,
      staff_directory_active: existing?.user_metadata?.staff_directory_active !== false,
    };
    const application = {
      ...(existing?.app_metadata || {}),
      must_change_password: forceChange,
      portal_access: accessLevel,
    };

    let userId;
    if (existing) {
      const { data, error } = await access.admin.auth.admin.updateUserById(existing.id, {
        password: temporaryPassword,
        user_metadata: profile,
        app_metadata: application,
        email_confirm: true,
      });
      if (error) return jsonError(error.message);
      userId = data?.user?.id || existing.id;
    } else {
      const { data, error } = await access.admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: profile,
        app_metadata: application,
      });
      if (error) return jsonError(error.message);
      userId = data?.user?.id;
    }

    if (!userId) return jsonError("Could not create the staff account.", 500);

    // Promotion is a distinct primary-administrator operation. Creating staff access
    // never removes existing admin access; removal is only handled by Portal Management.
    if (needsAdminAccess) {
      const { error } = await access.admin.from("admin_emails").upsert({
        email,
        added_by: normaliseEmail(access.user.email),
      }, { onConflict: "email" });
      if (error) return jsonError(error.message);
    }

    if (requestedStaffResources) {
      const { error } = await access.admin.from("portal_visibility_overrides").upsert(
        STAFF_RESOURCE_KEYS.map((resourceKey) => ({
          user_id: userId,
          resource_key: resourceKey,
          is_visible: staffResourceIsSelected(resourceKey, requestedStaffResources),
          updated_by: access.user.id,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,resource_key" },
      );
      if (error) {
        if (visibilitySchemaMissing(error)) {
          return jsonError("The staff visibility controls are not active in the database yet.", 503);
        }
        return jsonError(error.message);
      }
    }

    return Response.json({
      email,
      name: profile.full_name,
      accessLevel,
      tempPassword: temporaryPassword,
      reset: Boolean(existing),
    }, { status: existing ? 200 : 201 });
  } catch (error) {
    return serverError(error);
  }
}
