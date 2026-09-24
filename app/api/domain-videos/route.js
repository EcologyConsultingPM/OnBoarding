import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const audience = new URL(request.url).searchParams.get("audience") === "admin" ? "admin" : "staff";
    if (audience === "admin" && !access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, `${audience}.domain_videos`);
    if (denied) return denied;
    return Response.json({ audience, access: true });
  } catch (error) {
    return serverError(error);
  }
}
