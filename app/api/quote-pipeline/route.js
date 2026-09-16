import { requireSession, serverError } from "../../../lib/serverAuth";
import { canAccessPortalResource, requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "id, client, project, project_folder_link, quote_link, hyperlink, quote_total, initial_sent, sent_on, follow_up_on, status, comments, fully_invoiced, superseded, superseded_note, created_at, updated_at";
const NON_FINANCIAL_COLUMNS = "id, client, project, project_folder_link, quote_link, hyperlink, initial_sent, sent_on, follow_up_on, status, comments, fully_invoiced, superseded, superseded_note, created_at, updated_at";

function opt(v) { const t = typeof v === "string" ? v.trim() : ""; return t || null; }
function num(v) { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function bool(v) { return v === true || v === "true"; }
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
  const d = new Date(sentOn);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function mapValues(body, financialsVisible) {
  const status = ["pending", "successful", "unsuccessful", "withdrawn"].includes(body.status)
    ? body.status
    : "pending";
  return {
    client: opt(body.client),
    project: opt(body.project),
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

export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return Response.json({ error: "Administrators only." }, { status: 403 });
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;

    const financialsVisible = await canAccessPortalResource(
      access,
      "admin.quote_pipeline.financials",
    );
    const windowEnd = isoDateDaysAgo(0);
    const windowStart = isoDateDaysAgo(ISSUED_QUOTE_WINDOW_DAYS);
    const { data, error } = await access.admin
      .from("quote_pipeline")
      .select(financialsVisible ? COLUMNS : NON_FINANCIAL_COLUMNS)
      .eq("initial_sent", true)
      .gte("sent_on", windowStart)
      .lte("sent_on", windowEnd)
      .order("updated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const rows = data || [];

    // Superseded rows are excluded from active performance figures. Dollar values
    // are never selected or calculated unless Aaron has granted financial access.
    const live = rows.filter((r) => !r.superseded);
    const sent = live.filter((r) => r.initial_sent).length;
    const successful = live.filter((r) => r.status === "successful");
    const decided = live.filter((r) => r.status === "successful" || r.status === "unsuccessful").length;
    const estimatedPipeline = financialsVisible
      ? live.filter((r) => r.status === "pending").reduce((s, r) => s + (Number(r.quote_total) || 0), 0)
      : null;
    const successfulValue = financialsVisible
      ? successful.reduce((s, r) => s + (Number(r.quote_total) || 0), 0)
      : null;

    return Response.json({
      quotes: rows,
      financialsVisible,
      windowStart,
      windowEnd,
      summary: {
        sent,
        successful: successful.length,
        successRate: decided ? Math.round((successful.length / decided) * 100) : 0,
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
    if (body.quoteTotal !== undefined && body.quoteTotal !== null && body.quoteTotal !== "") {
      const parsed = Number(body.quoteTotal);
      if (Number.isFinite(parsed) && parsed < 0) {
        return Response.json({ error: "Quote total cannot be negative." }, { status: 400 });
      }
    }
    const financialsVisible = await canAccessPortalResource(
      access,
      "admin.quote_pipeline.financials",
    );
    const { data, error } = await access.admin
      .from("quote_pipeline")
      .insert({ ...mapValues(body, financialsVisible), created_by: access.user.id })
      .select(financialsVisible ? COLUMNS : NON_FINANCIAL_COLUMNS).single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ quote: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
