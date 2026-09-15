import { requireSession, serverError } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, kingdom, taxon_name, fields, hidden_photos, locked, locked_at, updated_at";
// Fields an admin is allowed to override on a profile.
const EDITABLE = ["name", "common", "listing", "family", "form", "habitat", "diag", "jur"];

// GET ?kingdom=flora|fauna  -> all overrides for that kingdom (any signed-in user,
// so staff see the corrected/published profile too).
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const url = new URL(request.url);
    const kingdom = url.searchParams.get("kingdom");
    let query = access.admin.from("species_overrides").select(COLUMNS);
    if (kingdom === "flora" || kingdom === "fauna") query = query.eq("kingdom", kingdom);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ overrides: data || [] });
  } catch (error) {
    return serverError(error);
  }
}

// POST -> admin saves/updates an override (field edits + hidden photos).
// Blocked if the record is locked (must unlock first).
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const b = await request.json();
    const kingdom = b.kingdom === "fauna" ? "fauna" : "flora";
    const taxon = (b.taxon_name || "").toString().trim();
    if (!taxon) return Response.json({ error: "taxon_name is required." }, { status: 400 });

    // Guard: cannot edit a locked profile without unlocking.
    const { data: existing } = await access.admin
      .from("species_overrides").select("id, locked").eq("kingdom", kingdom).eq("taxon_name", taxon).maybeSingle();
    if (existing?.locked) {
      return Response.json({ error: "This profile is locked (published). Unlock it before editing." }, { status: 409 });
    }

    // Whitelist the editable fields only.
    const fields = {};
    if (b.fields && typeof b.fields === "object") {
      for (const k of EDITABLE) {
        if (b.fields[k] !== undefined) fields[k] = b.fields[k];
      }
    }
    const hidden = Array.isArray(b.hidden_photos)
      ? b.hidden_photos.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];

    const row = {
      kingdom, taxon_name: taxon, fields, hidden_photos: hidden, updated_by: access.user.id,
    };
    const { data, error } = await access.admin
      .from("species_overrides").upsert(row, { onConflict: "kingdom,taxon_name" }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ override: data });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH -> admin locks or unlocks an override (published/approved toggle).
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const b = await request.json();
    const kingdom = b.kingdom === "fauna" ? "fauna" : "flora";
    const taxon = (b.taxon_name || "").toString().trim();
    if (!taxon) return Response.json({ error: "taxon_name is required." }, { status: 400 });
    const lock = b.locked === true;

    // Ensure a row exists (locking a profile that has no edits yet still publishes it).
    const { data, error } = await access.admin.from("species_overrides").upsert({
      kingdom, taxon_name: taxon,
      locked: lock,
      locked_by: lock ? access.user.id : null,
      locked_at: lock ? new Date().toISOString() : null,
      updated_by: access.user.id,
    }, { onConflict: "kingdom,taxon_name" }).select(COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ override: data });
  } catch (error) {
    return serverError(error);
  }
}
