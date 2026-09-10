/**
 * GET  /api/ecado/escalations/close — list open escalations
 * POST /api/ecado/escalations/close — { id, reason } close one
 *
 * A named human and a reason of substance are required, enforced here and
 * again by a CHECK constraint in the database (ecado_closure_requires_reason).
 */

import { requireEcadoViewerApi, auditEcado } from "../../../../../lib/ecado/access";
import { closeEscalation, openEscalations } from "../../../../../lib/ecado/escalations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const guard = await requireEcadoViewerApi(request);
  if (!guard.ok) return guard.response;
  return Response.json({ escalations: await openEscalations() });
}

export async function POST(request) {
  const guard = await requireEcadoViewerApi(request);
  if (!guard.ok) return guard.response;
  const { viewer } = guard;

  const body = await request.json().catch(() => ({}));
  const { id, reason } = body;
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });

  const result = await closeEscalation(id, viewer.email, reason ?? "");
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  await auditEcado(viewer.email, "escalation.close", { id, reason });
  return Response.json({ ok: true });
}
