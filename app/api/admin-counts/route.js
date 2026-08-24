import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight pending-work counts for admin domain badges. Admin-only.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ counts: {} });

    const [sr, whs] = await Promise.all([
      access.admin.from("service_requests").select("id", { count: "exact", head: true }).eq("status", "submitted"),
      access.admin.from("whs_forms").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    ]);

    return Response.json({
      counts: {
        servicerequests: sr.count || 0,
        whsmonitor: whs.count || 0,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
