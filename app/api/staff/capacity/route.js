import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { capacityData } from "../../admin/staff-capacity/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dateOnly(value) {
  if (!value) return null;
  const str = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validRange(start, end) {
  if (!start || !end) return false;
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return false;
  if (endDate < startDate) return false;
  return (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000) <= 366;
}

// Read-only staff view of the same workload data admins see. canEdit is
// hardcoded false here (never derived from the request) — this route has no
// PATCH/POST handler at all, so there is no edit path to gate in the first
// place, but the flag is still sent explicitly so the shared
// StaffCapacityPlanner component never has to guess which mode it's in.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(access, "staff.capacity");
    if (denied) return denied;
    const { searchParams } = new URL(request.url);
    const requestedStart = dateOnly(searchParams.get("start"));
    const requestedEnd = dateOnly(searchParams.get("end"));
    const rangeStart = requestedStart || new Date().toISOString().slice(0, 10);
    const rangeEnd = requestedEnd || addDays(rangeStart, 27);
    if (!validRange(rangeStart, rangeEnd)) return Response.json({ error: "Choose a valid period of up to 12 months." }, { status: 400 });
    const data = await capacityData(access, rangeStart, rangeEnd);
    return Response.json({ ...data, canEdit: false });
  } catch (error) {
    return serverError(error);
  }
}
