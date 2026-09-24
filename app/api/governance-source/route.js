import fs from "node:fs/promises";
import path from "node:path";
import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = {
  "EC-SWMS01": { file: "EC-SWMS01-fall-risk-over-two-metres.pdf", name: "EC-SWMS01 — Fall risk over two metres.pdf", type: "application/pdf" },
  "EC-SWMS04": { file: "EC-SWMS04-asbestos-observation-only.pdf", name: "EC-SWMS04 — Asbestos observation only.pdf", type: "application/pdf" },
  "EC-SWMS06": { file: "EC-SWMS06-confined-space.pdf", name: "EC-SWMS06 — Work in or near a confined space.pdf", type: "application/pdf" },
  "EC-SWMS08": { file: "EC-SWMS08-tunnel-ecological-survey.pdf", name: "EC-SWMS08 — Tunnel ecological survey activities.pdf", type: "application/pdf" },
  "EC-SWMS12": { file: "EC-SWMS12-energised-electrical-services.pdf", name: "EC-SWMS12 — Energised electrical installations or services.pdf", type: "application/pdf" },
  "EC-SWMS15": { file: "EC-SWMS15-live-traffic-corridor.pdf", name: "EC-SWMS15 — Live traffic corridor.pdf", type: "application/pdf" },
  "EC-SWMS16": { file: "EC-SWMS16-powered-mobile-plant.pdf", name: "EC-SWMS16 — Powered mobile plant.pdf", type: "application/pdf" },
  "EC-SWMS18": { file: "EC-SWMS18-water-drowning-risk.pdf", name: "EC-SWMS18 — Water and drowning risk.pdf", type: "application/pdf" },
  "EC-GEN-SWMS-001": { file: "EC-GEN-SWMS-001-ecological-field-surveys.md", name: "EC-GEN-SWMS-001 — Generic SWMS Ecological Field Surveys.md", type: "text/markdown; charset=utf-8" },
};

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.internal_governance" : "staff.forms",
    );
    if (denied) return denied;

    const key = new URL(request.url).searchParams.get("key") || "";
    const source = SOURCES[key];
    if (!source) return Response.json({ error: "Controlled source document not found." }, { status: 404 });

    const sourcePath = path.join(process.cwd(), "controlled-documents", "internal-generic-swms", source.file);
    const content = await fs.readFile(sourcePath);
    return new Response(content, {
      headers: {
        "Content-Type": source.type,
        "Content-Disposition": `inline; filename="${source.name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error?.code === "ENOENT") return Response.json({ error: "Controlled source document is unavailable." }, { status: 404 });
    return serverError(error);
  }
}
