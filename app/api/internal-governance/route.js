import { requireSession, serverError } from "../../../lib/serverAuth";
import { requirePortalResource } from "../../../lib/portalVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCUMENT_TYPES = new Set(["policy", "procedure"]);
const DRAFTABLE = new Set(["draft", "rejected"]);
const ALL_DOCUMENT_COLUMNS = `
  id, created_by, doc_type, title, category, version, body, document_link,
  storage_path, requires_ack, requires_training, status, consultation_scope,
  consultation_user_ids, consultation_starts_at, consultation_ends_at,
  submitted_for_approval_at, approved_by, approved_at, effective_date,
  next_review_date, supersedes_document_id, archived_at, published_at,
  created_at, updated_at
`;

function jsonError(error, status = 400) {
  return Response.json({ error }, { status });
}

function canStaffRead(document, userId) {
  if (document.status === "published") return true;
  if (document.status !== "in_review") return false;
  if (document.consultation_ends_at && new Date(document.consultation_ends_at) < new Date()) return false;
  return document.consultation_scope === "all_staff"
    || (document.consultation_user_ids || []).includes(userId);
}

function nextVersion(version = "1.0") {
  const [major, minor] = String(version).split(".").map((part) => Number(part));
  return `${Number.isFinite(major) ? major : 1}.${Number.isFinite(minor) ? minor + 1 : 0}`;
}

async function findDocument(admin, id) {
  const { data, error } = await admin
    .from("policy_documents")
    .select(ALL_DOCUMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function recordVersion(admin, document, changedBy, changeNote) {
  const { error } = await admin.from("policy_document_versions").insert({
    document_id: document.id,
    version: document.version,
    status: document.status,
    title: document.title,
    body: document.body,
    document_link: document.document_link,
    storage_path: document.storage_path,
    changed_by: changedBy,
    change_note: changeNote || null,
  });
  if (error) throw new Error(error.message);
}

async function publishNotice(admin, userId, document, message) {
  // The existing Staff Noticeboard is currently all-staff. Targeted consultation
  // remains visible only in the staff event feed, preventing unauthorised access.
  if (document.status !== "published" && document.consultation_scope !== "all_staff") return;
  const now = new Date().toISOString();
  const { error } = await admin.from("notices").insert({
    created_by: userId,
    title: document.status === "published" ? "New approved governance document" : "Governance document open for consultation",
    category: "Internal Governance",
    body: `${document.title} v${document.version}. ${message}`,
    status: "published",
    approved_by: userId,
    approved_at: now,
    published_at: now,
  });
  if (error) throw new Error(error.message);
}

async function publishGovernanceEvents(admin, document, eventType, severity, title, body) {
  let recipientIds = [];
  if (document.status === "published" || document.consultation_scope === "all_staff") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    recipientIds = (data?.users || []).map((user) => user.id);
  } else {
    recipientIds = document.consultation_user_ids || [];
  }
  if (!recipientIds.length) return;
  const { error } = await admin.from("portal_events").insert(recipientIds.map((recipientId) => ({
    recipient_id: recipientId,
    event_type: eventType,
    severity,
    title,
    body,
    href: "/staff/governance",
    source_table: "policy_documents",
    source_id: document.id,
  })));
  if (error) throw new Error(error.message);
}

// GET: returns a read-only staff library, or full governance register and staff
// list to an administrator. Access is enforced in the API because this query uses
// the server role for signed URL and acknowledgement aggregation.
export async function GET(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.internal_governance" : "staff.forms.governance",
    );
    if (denied) return denied;

    const { data, error } = await access.admin
      .from("policy_documents")
      .select(ALL_DOCUMENT_COLUMNS)
      .order("updated_at", { ascending: false });
    if (error) return jsonError(error.message);

    const documents = access.isAdmin
      ? (data || [])
      : (data || []).filter((document) => canStaffRead(document, access.user.id));

    const documentIds = documents.map((document) => document.id);
    const [ackResult, commentResult] = await Promise.all([
      documentIds.length
        ? access.admin.from("policy_acknowledgements").select("id, document_id, user_id, acknowledged_at, feedback").in("document_id", documentIds)
        : Promise.resolve({ data: [], error: null }),
      documentIds.length
        ? access.admin.from("policy_document_comments").select("id, document_id, author_id, body, created_at").in("document_id", documentIds).order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (ackResult.error) return jsonError(ackResult.error.message);
    if (commentResult.error) return jsonError(commentResult.error.message);

    const acksByDocument = new Map();
    (ackResult.data || []).forEach((ack) => {
      const rows = acksByDocument.get(ack.document_id) || [];
      rows.push(ack);
      acksByDocument.set(ack.document_id, rows);
    });
    const commentsByDocument = new Map();
    (commentResult.data || []).forEach((comment) => {
      if (!access.isAdmin && comment.author_id !== access.user.id) return;
      const rows = commentsByDocument.get(comment.document_id) || [];
      rows.push(comment);
      commentsByDocument.set(comment.document_id, rows);
    });

    const enrichedDocuments = documents.map((document) => {
      const acknowledgements = acksByDocument.get(document.id) || [];
      return {
        ...document,
        acknowledged: acknowledgements.some((ack) => ack.user_id === access.user.id),
        acknowledgement_count: acknowledgements.length,
        comments: commentsByDocument.get(document.id) || [],
      };
    });

    let staff = [];
    if (access.isAdmin) {
      const { data: list } = await access.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      staff = (list?.users || []).map((user) => ({
        id: user.id,
        name: user.user_metadata?.full_name || user.email,
        email: user.email,
      }));
    }

    return Response.json({ documents: enrichedDocuments, staff, isAdmin: access.isAdmin });
  } catch (error) {
    return serverError(error);
  }
}

// POST: create a draft or record staff acknowledgement/comment. Document creation
// is administrator-only. Staff may acknowledge approved documents and comment only
// on a consultation document they are permitted to read.
export async function POST(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.internal_governance" : "staff.forms.governance",
    );
    if (denied) return denied;
    const body = await request.json();

    if (body.action === "acknowledge") {
      const document = await findDocument(access.admin, body.document_id);
      if (!document || !canStaffRead(document, access.user.id) || document.status !== "published") {
        return jsonError("This document is not available for acknowledgement.", 403);
      }
      const { error } = await access.admin.from("policy_acknowledgements").upsert({
        document_id: document.id,
        user_id: access.user.id,
        feedback: typeof body.feedback === "string" ? body.feedback.trim() || null : null,
        acknowledged_at: new Date().toISOString(),
      }, { onConflict: "document_id,user_id" });
      if (error) return jsonError(error.message);
      return Response.json({ ok: true });
    }

    if (body.action === "comment") {
      const document = await findDocument(access.admin, body.document_id);
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      if (!comment || comment.length < 2) return jsonError("Please enter a meaningful consultation comment.");
      if (!document || !canStaffRead(document, access.user.id) || document.status !== "in_review") {
        return jsonError("Comments are permitted only on a document currently open to you for consultation.", 403);
      }
      const { data, error } = await access.admin.from("policy_document_comments").insert({
        document_id: document.id,
        author_id: access.user.id,
        body: comment,
      }).select("id, document_id, author_id, body, created_at").single();
      if (error) return jsonError(error.message);
      return Response.json({ comment: data }, { status: 201 });
    }

    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    if (body.action !== "create") return jsonError("Unknown action.");
    if (!DOCUMENT_TYPES.has(body.doc_type)) return jsonError("Choose Policy or Procedure.");
    if (!body.title || body.title.trim().length < 3) return jsonError("A document title is required.");

    const { data, error } = await access.admin.from("policy_documents").insert({
      created_by: access.user.id,
      doc_type: body.doc_type,
      title: body.title.trim(),
      category: (body.category || "Internal Governance").trim() || "Internal Governance",
      version: (body.version || "1.0").trim() || "1.0",
      body: (body.body || "").trim() || null,
      document_link: (body.document_link || "").trim() || null,
      storage_path: (body.storage_path || "").trim() || null,
      requires_ack: body.requires_ack !== false,
      requires_training: body.requires_training === true,
      status: "draft",
    }).select(ALL_DOCUMENT_COLUMNS).single();
    if (error) return jsonError(error.message);
    await recordVersion(access.admin, data, access.user.id, "Initial draft created.");
    return Response.json({ document: data }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

// PATCH: administrators move the controlled document through consultation,
// approval, publication, recall and archiving. No staff member can edit source
// material or alter another person's acknowledgement/comment.
export async function PATCH(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.internal_governance" : "staff.forms.governance",
    );
    if (denied) return denied;
    if (!access.isAdmin) return jsonError("Administrators only.", 403);
    const body = await request.json();
    const document = await findDocument(access.admin, body.id);
    if (!document) return jsonError("Document not found.", 404);
    const now = new Date().toISOString();
    let values = {};
    let versionNote = body.change_note || null;

    if (body.action === "edit_draft") {
      if (!DRAFTABLE.has(document.status)) return jsonError("Only draft or rejected documents can be edited. Create a revision of a published document.");
      values = {
        title: body.title?.trim() || document.title,
        category: body.category?.trim() || document.category,
        body: typeof body.body === "string" ? body.body.trim() || null : document.body,
        document_link: typeof body.document_link === "string" ? body.document_link.trim() || null : document.document_link,
        storage_path: typeof body.storage_path === "string" ? body.storage_path.trim() || null : document.storage_path,
        requires_ack: typeof body.requires_ack === "boolean" ? body.requires_ack : document.requires_ack,
        requires_training: typeof body.requires_training === "boolean" ? body.requires_training : document.requires_training,
        updated_at: now,
      };
    } else if (body.action === "open_consultation") {
      if (!DRAFTABLE.has(document.status)) return jsonError("Only a draft or amended rejected document can be opened for consultation.");
      const scope = body.consultation_scope === "selected_staff" ? "selected_staff" : "all_staff";
      const users = Array.isArray(body.consultation_user_ids) ? body.consultation_user_ids.filter(Boolean) : [];
      if (scope === "selected_staff" && !users.length) return jsonError("Select at least one staff member for a limited consultation.");
      if (!body.consultation_ends_at) return jsonError("A consultation closing date is required.");
      values = {
        status: "in_review",
        consultation_scope: scope,
        consultation_user_ids: scope === "selected_staff" ? users : [],
        consultation_starts_at: body.consultation_starts_at || now,
        consultation_ends_at: body.consultation_ends_at,
        updated_at: now,
      };
      versionNote = "Opened for consultation.";
    } else if (body.action === "submit_for_approval") {
      if (document.status !== "in_review") return jsonError("A document must complete consultation before approval submission.");
      values = { status: "pending_approval", submitted_for_approval_at: now, updated_at: now };
      versionNote = "Submitted for approval.";
    } else if (body.action === "approve_publish") {
      if (document.status !== "pending_approval") return jsonError("Only a document pending approval can be published.");
      if (!body.effective_date || !body.next_review_date) return jsonError("Effective and next review dates are required before publication.");
      values = {
        status: "published",
        approved_by: access.user.id,
        approved_at: now,
        published_at: now,
        effective_date: body.effective_date,
        next_review_date: body.next_review_date,
        updated_at: now,
      };
      versionNote = "Approved and published.";
    } else if (body.action === "reject") {
      if (document.status !== "pending_approval") return jsonError("Only a document pending approval can be rejected.");
      values = { status: "rejected", updated_at: now };
      versionNote = body.change_note || "Approval amendment requested.";
    } else if (body.action === "archive") {
      if (document.status !== "published") return jsonError("Only a published document can be archived.");
      values = { status: "archived", archived_at: now, updated_at: now };
      versionNote = "Archived.";
    } else if (body.action === "new_revision") {
      if (document.status !== "published") return jsonError("Only published documents can be revised.");
      const { data: revision, error } = await access.admin.from("policy_documents").insert({
        created_by: access.user.id,
        doc_type: document.doc_type,
        title: body.title?.trim() || document.title,
        category: document.category,
        version: body.version?.trim() || nextVersion(document.version),
        body: document.body,
        document_link: document.document_link,
        storage_path: document.storage_path,
        requires_ack: document.requires_ack,
        requires_training: document.requires_training,
        supersedes_document_id: document.id,
        status: "draft",
      }).select(ALL_DOCUMENT_COLUMNS).single();
      if (error) return jsonError(error.message);
      await recordVersion(access.admin, revision, access.user.id, `Revision created from v${document.version}.`);
      return Response.json({ document: revision }, { status: 201 });
    } else {
      return jsonError("Unknown governance action.");
    }

    const { data, error } = await access.admin
      .from("policy_documents")
      .update(values)
      .eq("id", document.id)
      .select(ALL_DOCUMENT_COLUMNS)
      .single();
    if (error) return jsonError(error.message);

    await recordVersion(access.admin, data, access.user.id, versionNote);
    if (body.action === "open_consultation") {
      const message = `Consultation closes ${new Date(data.consultation_ends_at).toLocaleDateString("en-AU")}.`;
      await publishNotice(access.admin, access.user.id, data, message);
      await publishGovernanceEvents(access.admin, data, "governance_consultation_open", "review", "Governance document open for consultation", `${data.title} v${data.version}. ${message}`);
    }
    if (body.action === "submit_for_approval") {
      await publishGovernanceEvents(access.admin, data, "governance_approval_required", "approval", "Governance document awaiting approval", `${data.title} v${data.version} is ready for approval.`);
    }
    if (body.action === "approve_publish") {
      const message = `Effective ${new Date(data.effective_date).toLocaleDateString("en-AU")}. ${data.requires_ack ? "Staff acknowledgement is required." : ""}`;
      await publishNotice(access.admin, access.user.id, data, message);
      await publishGovernanceEvents(access.admin, data, "governance_published", "information", "New approved governance document", `${data.title} v${data.version}. ${message}`);
    }

    return Response.json({ document: data });
  } catch (error) {
    return serverError(error);
  }
}

// Returns a short-lived Storage URL only after the document's visibility rules
// have been checked for the requesting staff member.
export async function PUT(request) {
  try {
    const access = await requireSession(request);
    if (access.error) return access.error;
    const denied = await requirePortalResource(
      access,
      access.isAdmin ? "admin.internal_governance" : "staff.forms.governance",
    );
    if (denied) return denied;
    const { id } = await request.json();
    const document = await findDocument(access.admin, id);
    if (!document || (!access.isAdmin && !canStaffRead(document, access.user.id))) {
      return jsonError("You do not have access to this document.", 403);
    }
    if (!document.storage_path) return jsonError("No uploaded source document is attached.", 404);

    const { data, error } = await access.admin.storage
      .from("governance-documents")
      .createSignedUrl(document.storage_path, 300);
    if (error) return jsonError(error.message);
    return Response.json({ signed_url: data.signedUrl });
  } catch (error) {
    return serverError(error);
  }
}
