import { requireSession, serverError } from "../../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORE_COLUMNS = [
  { key: "work_date", label: "Work date", type: "date", required: true, locked: true },
  { key: "staff_name", label: "Staff member", type: "text", required: true, locked: true },
  { key: "activity_category", label: "Activity category", type: "select", required: true, locked: true },
  { key: "activity_information", label: "Activity information", type: "textarea", required: true, locked: true },
  { key: "hours", label: "Hours", type: "number", required: true, locked: true },
  { key: "status", label: "Status", type: "select", required: true, locked: true },
  { key: "notable_issues", label: "Notable issues", type: "textarea", required: false, locked: true },
];
const DEFAULT_CATEGORIES = ["Desktop / field plan", "Preparation", "Fieldwork & travel", "Data management", "Reporting", "GIS / mapping", "QA review", "Client consultation", "General project management", "Other"];

function jsonError(error, status = 400) { return Response.json({ error }, { status }); }
function unavailable(error) {
  const code = String(error?.code || ""); const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist") || message.includes("schema cache");
}
function validId(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
function cleanText(value, maximum = 5000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function cleanCategories(value) {
  const values = Array.isArray(value) ? value : DEFAULT_CATEGORIES;
  return [...new Set(values.map((item) => cleanText(String(item), 80)).filter(Boolean))].slice(0, 50);
}
function cleanColumns(value) {
  const custom = (Array.isArray(value) ? value : []).map((column, index) => ({
    key: cleanText(String(column?.key || `custom_${index + 1}`), 48).toLowerCase().replace(/[^a-z0-9_]/g, "_") || `custom_${index + 1}`,
    label: cleanText(String(column?.label || ""), 80),
    type: ["text", "number", "date", "textarea", "select"].includes(column?.type) ? column.type : "text",
    required: column?.required === true,
    locked: false,
    options: Array.isArray(column?.options) ? column.options.map((option) => cleanText(String(option), 80)).filter(Boolean).slice(0, 30) : [],
  })).filter((column) => column.label).slice(0, 20);
  const reserved = new Set(CORE_COLUMNS.map((column) => column.key));
  const unique = [];
  custom.forEach((column) => { if (!reserved.has(column.key) && !unique.some((item) => item.key === column.key)) unique.push(column); });
  return unique;
}
function cleanRows(value) { return (Array.isArray(value) ? value : []).map((row) => ({ label: cleanText(String(row?.label || ""), 120), information: cleanText(String(row?.information || ""), 1000) })).filter((row) => row.label || row.information).slice(0, 30); }
function shape(row) {
  return {
    id: row?.id || null,
    projectId: row?.project_id || null,
    templateName: row?.template_name || "Project Tracker",
    instructions: row?.instructions || "Record your project activity accurately and highlight issues that require project-lead review.",
    categories: Array.isArray(row?.category_options) && row.category_options.length ? row.category_options : DEFAULT_CATEGORIES,
    coreColumns: CORE_COLUMNS,
    customColumns: Array.isArray(row?.column_definitions) ? row.column_definitions : [],
    guidanceRows: Array.isArray(row?.guidance_rows) ? row.guidance_rows : [],
    locked: Boolean(row?.locked),
    lockedAt: row?.locked_at || null,
    updatedAt: row?.updated_at || null,
  };
}
async function requireAdmin(request) {
  const access = await requireSession(request);
  if (access.error) return { error: access.error };
  if (!access.isAdmin) return { error: jsonError("Administrator access is required.", 403) };
  return { access };
}

export async function GET(request) {
  try {
    const auth = await requireAdmin(request); if (auth.error) return auth.error;
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!validId(projectId)) return jsonError("A valid project is required.");
    const { data, error } = await auth.access.admin.from("project_tracker_templates").select("*").eq("project_id", projectId).maybeSingle();
    if (error) { if (unavailable(error)) return Response.json({ templateReady: false, template: shape(null) }); return jsonError(error.message); }
    return Response.json({ templateReady: true, template: shape(data) });
  } catch (error) { return serverError(error); }
}

export async function PUT(request) {
  try {
    const auth = await requireAdmin(request); if (auth.error) return auth.error;
    const body = await request.json(); const projectId = String(body?.projectId || "");
    if (!validId(projectId)) return jsonError("A valid project is required.");
    const { data: current, error: currentError } = await auth.access.admin.from("project_tracker_templates").select("*").eq("project_id", projectId).maybeSingle();
    if (currentError && !unavailable(currentError)) return jsonError(currentError.message);
    if (currentError && unavailable(currentError)) return jsonError("Project Tracker templates are awaiting the approved tracker migration.", 409);
    if (current?.locked) return jsonError("Unlock the template before changing its categories, columns, rows or instructions.", 409);
    const now = new Date().toISOString();
    const payload = { project_id: projectId, template_name: cleanText(body.templateName, 120) || "Project Tracker", instructions: cleanText(body.instructions, 5000), category_options: cleanCategories(body.categories), column_definitions: cleanColumns(body.customColumns), guidance_rows: cleanRows(body.guidanceRows), locked: false, updated_by: auth.access.user.id, updated_at: now };
    const { data, error } = await auth.access.admin.from("project_tracker_templates").upsert(current ? payload : { ...payload, created_by: auth.access.user.id }, { onConflict: "project_id" }).select("*").single();
    if (error) return jsonError(error.message);
    return Response.json({ template: shape(data) });
  } catch (error) { return serverError(error); }
}

export async function PATCH(request) {
  try {
    const auth = await requireAdmin(request); if (auth.error) return auth.error;
    const body = await request.json(); const projectId = String(body?.projectId || "");
    if (!validId(projectId)) return jsonError("A valid project is required.");
    const action = String(body?.action || "");
    if (!["lock", "unlock"].includes(action)) return jsonError("Choose lock or unlock.");
    const { data: current, error: readError } = await auth.access.admin.from("project_tracker_templates").select("*").eq("project_id", projectId).maybeSingle();
    if (readError) return jsonError(unavailable(readError) ? "Project Tracker templates are awaiting the approved tracker migration." : readError.message, unavailable(readError) ? 409 : 400);
    if (!current) return jsonError("Save the tracker template before locking it.", 409);
    if (action === "lock" && !(Array.isArray(current.category_options) && current.category_options.length)) return jsonError("Add at least one activity category before locking the template.", 409);
    const now = new Date().toISOString();
    const values = action === "lock" ? { locked: true, locked_by: auth.access.user.id, locked_at: now, updated_by: auth.access.user.id, updated_at: now } : { locked: false, locked_by: null, locked_at: null, updated_by: auth.access.user.id, updated_at: now };
    const { data, error } = await auth.access.admin.from("project_tracker_templates").update(values).eq("project_id", projectId).select("*").single();
    if (error) return jsonError(error.message);
    await auth.access.admin.from("project_tracker_template_events").insert({ project_id: projectId, template_id: current.id, action: action === "lock" ? "template_locked" : "template_unlocked", actor_id: auth.access.user.id, template_snapshot: shape(data), created_at: now });
    return Response.json({ template: shape(data) });
  } catch (error) { return serverError(error); }
}
