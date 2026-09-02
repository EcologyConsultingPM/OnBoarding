export async function recordAudit(admin, {
  actorId,
  action,
  entityType,
  entityId = null,
  projectId = null,
  resourceKey = null,
  beforeData = null,
  afterData = null,
  reason = null,
}) {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      actor_id: actorId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      project_id: projectId || null,
      resource_key: resourceKey || null,
      before_data: beforeData,
      after_data: afterData,
      reason: reason || null,
    });
    if (error) console.warn("Audit log write failed:", error.message);
  } catch (error) {
    console.warn("Audit log write failed:", error?.message || error);
  }
}

export function compactAuditRecord(record, keys = []) {
  if (!record || typeof record !== "object") return null;
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}
