import { requireSession, serverError } from "../../../../lib/serverAuth";
import { requirePortalResource } from "../../../../lib/portalVisibility";
import { listDirectoryUsers } from "../../../../lib/staffDirectory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRAFT_COLUMNS = "id, created_by, client_name, company, client_email, client_phone, preferred_contact_method, project_name, project_location, local_government_area, state, enquiry_description, required_services, development_type, site_constraints, project_drivers, consent_authority, authority_comments, biodiversity_information_request, ref_bar_requirements, planning_pathway, additional_agency_requirements, enquiry_received_on, client_required_by, approval_timeframes, urgency, assigned_to, assigned_name, status, client_contacted, contact_date, contact_notes, scope_confirmed, project_number, quote_number, deliverables, quote_sent_by, quote_sent_by_name, quote_draft_link, attachments, quote_pdf_path, quote_sent, quote_sent_on, quote_recipient_email, transferred_quote_id, transferred_at, created_at, updated_at";
const URGENCY = new Set(["low", "medium", "high", "critical"]);
const STATUS = new Set(["awaiting_review", "awaiting_contact", "ready_to_generate", "withdrawn"]);

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function text(value, maximum = 4000) {
  const clean = String(value || "").trim();
  return clean ? clean.slice(0, maximum) : null;
}

function date(value) {
  const clean = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

function email(value) {
  const clean = text(value, 320);
  if (!clean) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean.toLowerCase() : null;
}

function url(value) {
  const clean = text(value, 2000);
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function bool(value) {
  return value === true || value === "true";
}

function readyForNumbers(values) {
  return Boolean(values.client_contacted);
}

function toValues(body, directory, current) {
  const assignedTo = text(body?.assignedTo, 100);
  const assignedPerson = assignedTo ? directory.find((person) => person.id === assignedTo && person.active) : null;
  if (assignedTo && !assignedPerson) throw new Error("Choose an active staff member from the authorised Staff List.");
  const quoteSentBy = text(body?.quoteSentBy, 100);
  const quoteSentByPerson = quoteSentBy ? directory.find((person) => person.id === quoteSentBy && person.active) : null;
  if (quoteSentBy && !quoteSentByPerson) throw new Error("Choose an active staff member for Quote sent by.");
  const clientEmail = email(body?.clientEmail);
  const recipientEmail = email(body?.quoteRecipientEmail);
  if (text(body?.clientEmail, 320) && !clientEmail) throw new Error("Enter a valid client email address.");
  if (text(body?.quoteRecipientEmail, 320) && !recipientEmail) throw new Error("Enter a valid quote recipient email address.");
  const urgency = String(body?.urgency || current.urgency || "medium").trim().toLowerCase();
  const requestedStatus = String(body?.status || "").trim();
  const values = {
    client_name: text(body?.clientName, 240),
    company: text(body?.company, 240),
    client_email: clientEmail,
    client_phone: text(body?.clientPhone, 80),
    preferred_contact_method: text(body?.preferredContactMethod, 80),
    project_name: text(body?.projectName, 240),
    project_location: text(body?.projectLocation, 500),
    local_government_area: text(body?.localGovernmentArea, 240),
    state: text(body?.state, 80),
    enquiry_description: text(body?.enquiryDescription, 12000),
    required_services: text(body?.requiredServices, 3000),
    additional_agency_requirements: text(body?.additionalAgencyRequirements, 5000),
    enquiry_received_on: date(body?.enquiryReceivedOn) || current.enquiry_received_on,
    client_required_by: date(body?.clientRequiredBy),
    approval_timeframes: text(body?.approvalTimeframes, 1000),
    urgency: URGENCY.has(urgency) ? urgency : "medium",
    assigned_to: assignedPerson?.id || null,
    assigned_name: assignedPerson?.name || null,
    client_contacted: bool(body?.clientContacted),
    contact_date: date(body?.contactDate),
    contact_notes: text(body?.contactNotes, 5000),
    scope_confirmed: text(body?.scopeConfirmed, 5000),
    quote_draft_link: url(body?.quoteDraftLink),
    quote_sent: bool(body?.quoteSent),
    quote_sent_on: date(body?.quoteSentOn),
    quote_recipient_email: recipientEmail,
    project_number: text(body?.projectNumber, 60),
    quote_number: text(body?.quoteNumber, 60),
    deliverables: text(body?.deliverables, 500),
    quote_sent_by: quoteSentByPerson?.id || null,
    quote_sent_by_name: quoteSentByPerson?.name || null,
    updated_at: new Date().toISOString(),
  };

  if (current.status !== "quote_drafting" && current.status !== "transferred") {
    if (requestedStatus === "withdrawn") values.status = "withdrawn";
    // Numbers used to be generated by a controlled button, which is what
    // moved status to "quote_drafting" (a status the transfer step requires
    // by database rule). Numbers are now entered manually, so reaching that
    // same status is triggered by both numbers being present instead.
    else if (values.project_number && values.quote_number) values.status = "quote_drafting";
    else if (readyForNumbers(values)) values.status = "ready_to_generate";
    else values.status = values.assigned_to ? "awaiting_contact" : "awaiting_review";
  }
  return values;
}

async function notifyAssignee(admin, draft, recipientId, kind = "assigned") {
  if (!recipientId) return;
  const { error } = await admin.from("portal_events").insert({
    recipient_id: recipientId,
    event_type: kind === "assigned" ? "quote_draft_assigned" : "quote_draft_ready",
    severity: kind === "assigned" ? "action" : "information",
    title: kind === "assigned" ? "Quote enquiry assigned" : "Quote enquiry ready to draft",
    body: kind === "assigned"
      ? `${draft.client_name}${draft.project_name ? ` · ${draft.project_name}` : ""} requires review and direct client contact before quote preparation.`
      : `${draft.client_name}${draft.project_name ? ` · ${draft.project_name}` : ""} is ready for controlled quote number generation.`,
    href: "/?portal=admin&area=quote_pipeline&quoteView=drafts",
    source_table: "quote_drafts",
    source_id: draft.id,
  });
  if (error) console.warn("Quote draft notification could not be created:", error.message);
}

async function readDraft(admin, draftId) {
  const { data, error } = await admin.from("quote_drafts").select(DRAFT_COLUMNS).eq("id", draftId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function PATCH(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;

    const body = await request.json();
    const action = String(body?.action || "save").trim();
    const current = await readDraft(access.admin, params.draftId);

    if (action === "generate_numbers") {
      if (current.status === "transferred") return jsonError("This enquiry has already been transferred to the issued Quote Pipeline.", 409);
      const { data, error } = await access.admin.rpc("generate_quote_draft_numbers", { p_draft_id: current.id });
      if (error) return jsonError(error.message);
      const draft = await readDraft(access.admin, current.id);
      await notifyAssignee(access.admin, draft, draft.assigned_to, "ready");
      return Response.json({ draft, numbers: data || [] });
    }

    if (action === "transfer") {
      const { data, error } = await access.admin.rpc("transfer_quote_draft_to_pipeline", {
        p_draft_id: current.id,
        p_actor_id: access.user.id,
      });
      if (error) return jsonError(error.message);
      const draft = await readDraft(access.admin, current.id);
      return Response.json({ draft, quoteId: data?.[0]?.quote_id || draft.transferred_quote_id });
    }

    if (current.status === "transferred") return jsonError("Transferred enquiries are retained as audit records and cannot be edited here.", 409);
    const directory = await listDirectoryUsers(access.admin, { activeOnly: true });
    const values = toValues(body, directory, current);
    if (!values.client_name && !values.company) return jsonError("Enter a client name or company for the enquiry.");
    const wasAssigned = current.assigned_to;
    const { data: draft, error } = await access.admin
      .from("quote_drafts")
      .update(values)
      .eq("id", current.id)
      .select(DRAFT_COLUMNS)
      .single();
    if (error) return jsonError(error.message);
    if (draft.assigned_to && draft.assigned_to !== wasAssigned) await notifyAssignee(access.admin, draft, draft.assigned_to);
    if (draft.status === "ready_to_generate" && current.status !== "ready_to_generate") await notifyAssignee(access.admin, draft, draft.assigned_to, "ready");
    return Response.json({ draft });
  } catch (error) {
    return jsonError(error.message || "Could not update the quote enquiry.", 400);
  }
}

export async function DELETE(request, { params }) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const denied = await requirePortalResource(access, "admin.quote_pipeline");
    if (denied) return denied;
    const current = await readDraft(access.admin, params.draftId);
    if (current.transferred_quote_id) return jsonError("Transferred enquiries are retained for audit and cannot be deleted.", 409);
    const { error } = await access.admin.from("quote_drafts").delete().eq("id", current.id);
    if (error) return jsonError(error.message);
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
