import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only WHS monitoring rollup. Aggregates the real WHS records that exist
// today: controlled drafts (SWMS / psychosocial), toolbox talks and incident
// reports. Reports counts by status, the queue awaiting review/approval, and a
// per-person breakdown of what each staff member has submitted.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });

    const [{ data: drafts }, { data: talks }, { data: incidents }, { data: usersData }] = await Promise.all([
      access.admin.from("whs_drafts").select("id, title, document_type, status, created_by, review_date, updated_at"),
      access.admin.from("toolbox_talk_records").select("id, status, created_by, updated_at"),
      access.admin.from("incident_reports").select("id, status, created_by, incident_types, updated_at"),
      access.admin.auth.admin.listUsers(),
    ]);

    const emailById = new Map((usersData?.users || []).map((u) => [u.id, u.email]));
    const nameFrom = (id) => emailById.get(id) || "Unknown";

    const countBy = (rows, field = "status") => {
      const out = { draft: 0, ready_for_review: 0, approved: 0 };
      for (const r of rows || []) out[r[field]] = (out[r[field]] || 0) + 1;
      return out;
    };

    const draftCounts = countBy(drafts);
    const talkCounts = countBy(talks);
    const incidentCounts = countBy(incidents);

    // Awaiting-review queue across all WHS record types.
    const awaiting = [
      ...(drafts || []).filter((d) => d.status === "ready_for_review").map((d) => ({ id: d.id, kind: d.document_type === "psychosocial" ? "Psychosocial RA" : "SWMS draft", title: d.title, author: nameFrom(d.created_by), updated_at: d.updated_at })),
      ...(incidents || []).filter((i) => i.status === "ready_for_review").map((i) => ({ id: i.id, kind: "Incident report", title: (i.incident_types || []).join(", ") || "Incident", author: nameFrom(i.created_by), updated_at: i.updated_at })),
      ...(talks || []).filter((t) => t.status === "ready_for_review").map((t) => ({ id: t.id, kind: "Toolbox talk", title: "Toolbox talk", author: nameFrom(t.created_by), updated_at: t.updated_at })),
    ].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    // Per-person breakdown: how many of each WHS record type each person has,
    // and how many are still approved/completed.
    const people = new Map();
    const bump = (id, key, approvedKey, isApproved) => {
      if (!people.has(id)) people.set(id, { email: nameFrom(id), drafts: 0, talks: 0, incidents: 0, approved: 0 });
      const p = people.get(id);
      p[key] += 1;
      if (isApproved) p.approved += 1;
    };
    for (const d of drafts || []) bump(d.created_by, "drafts", null, d.status === "approved");
    for (const t of talks || []) bump(t.created_by, "talks", null, t.status === "approved");
    for (const i of incidents || []) bump(i.created_by, "incidents", null, i.status === "approved");

    return Response.json({
      summary: {
        totalDrafts: (drafts || []).length,
        totalTalks: (talks || []).length,
        totalIncidents: (incidents || []).length,
        awaitingReview: awaiting.length,
      },
      byStatus: { drafts: draftCounts, talks: talkCounts, incidents: incidentCounts },
      awaiting,
      people: Array.from(people.values()).sort((a, b) => (b.drafts + b.talks + b.incidents) - (a.drafts + a.talks + a.incidents)),
    });
  } catch (error) {
    return serverError(error);
  }
}
