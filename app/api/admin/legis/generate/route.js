import { requireSession, serverError } from "../../../../../lib/serverAuth";
import { runLegisBrief } from "../../../jobs/legis-brief/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// This complements, rather than weakens, the Vercel cron endpoint. It lets an
// authenticated administrator repair or publish a missed weekly run without
// needing access to CRON_SECRET or exposing a public scheduler trigger.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) {
      return Response.json(
        { error: "Only administrators can generate a Legis briefing." },
        { status: 403 },
      );
    }
    return Response.json(await runLegisBrief());
  } catch (error) {
    return serverError(error);
  }
}
