import { requireSession, serverError } from "../../../lib/serverAuth";
import { canAccessPortalResource, requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, company, client, project, quote_draft_id, project_folder_link, quote_link, hyperlink, quote_total, initial_sent, sent_on, follow_up_on, status, comments, fully_invoiced, superseded, superseded_note, created_at, updated_at";
const NON_FINANCIAL_COLUMNS = "id, company, client, project, quote_draft_id, project_folder_link, quote_link, hyperlink, initial_sent, sent_on, follow_up_on, status, comments, fully_invoiced, superseded, superseded_note, created_at, updated_at";
const DRAFT_OPTION_COLUMNS = "id, company, client_name, project_name, quote_number, project_number, status, transferred_quote_id, updated_at";

function opt(value) { const text = typeof value === "string" ? value.trim() : ""; return text || null; }
function num(value) { if (value === "" || value == null) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function bool(value) { return value === true || value === "true"; }
function validId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
const ISSUED_QUOTE_WINDOW_DAYS = 30;

function isoDateDaysAgo(days) {
  // Quote sent dates are business dates for Ecology Consulting in NSW/ACT.
  // Vercel runs in UTC; using its calendar day hid a quote sent "today" until
  // UTC reached midnight (late morning/afternoon in Sydney).
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type) => fields.find((part) => part.type === type)?.value;
  const date = new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day"))));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// Follow-up defaults to 7 days after "sent on" when not given (matches sheet).
function deriveFollowUp(sentOn, explicit) {
  if (opt(explicit)) return opt(explicit);
  if (!opt(sentOn)) return null;
  const date = new Date(sentOn);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function mapValues(body, financialsVisible, draft = null) {
  const status = ["pending", "successful", "unsuccessful", "withdrawn"].includes(body.status)
    ? body.status
    : "pending";
  return {
    // A manually-added issued quote is deliberately anchored to an enquiry from
    // Quotes to be Drafted. Company, primary contact and project come from that
    // source rather than being retyped, preserving commercial traceability.
    company: opt(draft?.company || draft?.client_name || body.company),
    client: opt(draft?.client_name || body.client),
    project: opt(draft?.project_name || body.project),
    quote_draft_id: draft?.id || null,
    project_folder_link: opt(body.projectFolderLink),
    quote_link: opt(body.quoteLink),
    hyperlink: opt(body.hyperlink),
    ...(financialsVisible ? { quote_total: num(body.quoteTotal) } : {}),
    initial_sent: bool(body.initialSent),
    sent_on: opt(body.sentOn),
    follow_up_on: deriveFollowUp(body.sentOn, body.followUpOn),
    status,
    comments: opt(body.comments),
    fully_invoiced: bool(body.fullyInvoiced),
    superseded: bool(body.superseded),
    superseded_note: opt(body.supersededNote),
  };
}

async function availableDraftOptions(admin) {
  const { data, error } = await admin
    .from("quote_drafts")
    .select(DRAFT_OPTION_COLUMNS)
    .neq("status", "withdrawn")
    .is("transferred_quote_id", null)
    .order("company", { ascending: true })
    .order("project_name", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;

    const financialsVisible = await canAccessPortalResource(access, "admin.quote_pipeline.financials");
    const windowEnd = isoDateDaysAgo(0);
    const windowStart = isoDateDaysAgo(ISSUED_QUOTE_WINDOW_DAYS);
    const [pipelineResult, draftOptions] = await Promise.all([
      access.admin
        .from("quote_pipeline")
        .select(financialsVisible ? COLUMNS : NON_FINANCIAL_COLUMNS)
        .eq("initial_sent", true)
        .gte("sent_on", windowStart)
        .lte("sent_on", windowEnd)
        .order("updated_at", { ascending: false }),
      availableDraftOptions(access.admin),
    ]);
    if (pipelineResult.error) return Response.json({ error: pipelineResult.error.message }, { status: 400 });
    const rows = pipelineResult.data || [];

    // Superseded rows are excluded from active performance figures. Dollar values
    // are never selected or calculated unless Aaron has granted financial access.
    const live = rows.filter((row) => !row.superseded);
    const sent = live.filter((row) => row.initial_sent).length;
    const successful = live.filter((row) => row.status === "successful");
    const estimatedPipeline = financialsVisible
      ? live.filter((row) => row.status === "pending").reduce((sum, row) => sum + (Number(row.quote_total) || 0), 0)
      : null;
    const successfulValue = financialsVisible
      ? successful.reduce((sum, row) => sum + (Number(row.quote_total) || 0), 0)
      : null;

    return Response.json({
      quotes: rows,
      draftOptions,
      financialsVisible,
      windowStart,
      windowEnd,
      summary: {
        sent,
        successful: successful.length,
        // The commercial success rate is the share of every quote sent in this
        // rolling cohort that has become successful — not only the subset with
        // a final success/unsuccessful decision. Pending and withdrawn quotes
        // therefore remain in the denominator until they leave the 30-day view.
        successRate: sent ? Math.round((successful.length / sent) * 100) : 0,
        estimatedPipeline: estimatedPipeline == null ? null : Math.round(estimatedPipeline),
        successfulValue: successfulValue == null ? null : Math.round(successfulValue),
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;

    const body = await request.json();
    const draftId = String(body?.quoteDraftId || "").trim();
    if (!validId(draftId)) return Response.json({ error: "Select a company and project from Quotes to be Drafted before adding an issued quote." }, { status: 400 });
    if (body.quoteTotal !== undefined && body.quoteTotal !== null && body.quoteTotal !== "") {
      const parsed = Number(body.quoteTotal);
      if (Number.isFinite(parsed) && parsed < 0) return Response.json({ error: "Quote total cannot be negative." }, { status: 400 });
    }

    const { data: draft, error: draftError } = await access.admin
      .from("quote_drafts")
      .select(DRAFT_OPTION_COLUMNS)
      .eq("id", draftId)
      .neq("status", "withdrawn")
      .is("transferred_quote_id", null)
      .maybeSingle();
    if (draftError) return Response.json({ error: draftError.message }, { status: 400 });
    if (!draft) return Response.json({ error: "That draft enquiry has already been transferred or is no longer available." }, { status: 409 });
    if (!opt(draft.company)) return Response.json({ error: "Add a company to the selected enquiry before creating its issued quote." }, { status: 400 });
    if (!opt(draft.project_name)) return Response.json({ error: "Add a project name to the selected enquiry before creating its issued quote." }, { status: 400 });

    const { data: existing, error: existingError } = await access.admin
      .from("quote_pipeline")
      .select("id")
      .eq("quote_draft_id", draft.id)
      .maybeSingle();
    if (existingError) return Response.json({ error: existingError.message }, { status: 400 });
    if (existing) return Response.json({ error: "An issued quote already exists for the selected draft enquiry." }, { status: 409 });

    const financialsVisible = await canAccessPortalResource(access, "admin.quote_pipeline.financials");
    const { data, error } = await access.admin
      .from("quote_pipeline")
      .insert({ ...mapValues(body, financialsVisible, draft), created_by: access.user.id })
      .select(financialsVisible ? COLUMNS : NON_FINANCIAL_COLUMNS)
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const { error: transferError } = await access.admin
      .from("quote_drafts")
      .update({ transferred_quote_id: data.id, transferred_at: new Date().toISOString(), status: "transferred", updated_at: new Date().toISOString() })
      .eq("id", draft.id)
      .is("transferred_quote_id", null);
    if (transferError) {
      await access.admin.from("quote_pipeline").delete().eq("id", data.id);
      return Response.json({ error: `The issued quote could not be linked to its source enquiry: ${transferError.message}` }, { status: 400 });
    }
    return Response.json({ quote: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
