import { requireSession, serverError } from "../../../../lib/serverAuth";
import { isEcologyStaffEmail, listDirectoryUsers, normaliseStaffEmail, staffDirectoryRecord } from "../../../../lib/staffDirectory";
import { isPrimaryAdministrator, isProtectedPrimaryEmail } from "../../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(error, status = 400) {
  return Response.json({ error }, { status });
}

function cleanName(value, limit = 80) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
}
function cleanPhone(value) {
  return String(value || "").trim().replace(/[^0-9+()\-\s]/g, "").slice(0, 32);
}

async function adminAccess(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  if (!access.isAdmin) return { error: responseError("Administrator access is required.", 403) };
  return { access };
}

export async function GET(request) {
  try {
    const auth = await adminAccess(request);
    if (auth.error) return auth.error;
    const staff = await listDirectoryUsers(auth.access.admin);
    return Response.json({ staff });
  } catch (error) {
    return serverError(error);
  }
}

// Directory details are stored in each staff user's secure Auth metadata so the
// same central source is used by staff creation, allocation and task assignment.
// This route does not change account passwords or administrator privileges.
export async function PATCH(request) {
  try {
    const auth = await adminAccess(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const id = String(body?.id || "").trim();
    if (!id) return responseError("A staff record is required.");

    const { data: lookup, error: lookupError } = await auth.access.admin.auth.admin.getUserById(id);
    if (lookupError || !lookup?.user || !isEcologyStaffEmail(lookup.user.email)) return responseError("Staff record not found.", 404);

    const firstName = cleanName(body?.firstName);
    const lastName = cleanName(body?.lastName);
    if (!firstName || !lastName) return responseError("First and last name are required.");
    if (isProtectedPrimaryEmail(lookup.user.email)) {
      return responseError("Protected administrators cannot be removed from the Staff List.", 403);
    }
    if (body?.active === false && !isPrimaryAdministrator(auth.access)) {
      return responseError("Only Aaron Dooley or Tony Webster can remove a staff member from new allocations.", 403);
    }

    const existing = lookup.user.user_metadata || {};
    const metadata = {
      ...existing,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      phone: cleanPhone(body?.phone),
      staff_directory_active: body?.active !== false,
    };
    const { data, error } = await auth.access.admin.auth.admin.updateUserById(id, { user_metadata: metadata });
    if (error) return responseError(error.message);
    return Response.json({ staff: staffDirectoryRecord(data.user) });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const auth = await adminAccess(request);
    if (auth.error) return auth.error;
    const body = await request.json();
    const email = normaliseStaffEmail(body?.email);
    if (!isEcologyStaffEmail(email)) return responseError("Enter a valid Ecology Consulting email address.");
    return responseError("Create a new staff account through Access & administrator control, then maintain their phone and allocation availability here.", 409);
  } catch (error) {
    return serverError(error);
  }
}
