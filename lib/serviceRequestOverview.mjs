const present = (value) => value != null && typeof value !== "object" && String(value).trim() !== "";

export function formatRequestDate(value) {
  if (!present(value)) return "Not provided";
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return raw;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function getRequestStaffName(request, sessionUser) {
  if (present(request?.authorName)) return String(request.authorName);
  if (request?.created_by && request.created_by === sessionUser?.id) {
    return sessionUser.user_metadata?.full_name || sessionUser.user_metadata?.name || sessionUser.email || "";
  }
  return request?.author || "";
}

function formatApprovalTime(value) {
  if (!present(value)) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "Australia/Sydney", timeZoneName: "short",
  }).format(parsed);
}

export function getServiceRequestOverview(request, staffName) {
  const details = request?.details && typeof request.details === "object" && !Array.isArray(request.details) ? request.details : {};
  const reasonKey = present(details.reason) ? "reason" : null;
  const decision = request?.decision_status || (request?.status === "approved" || request?.status === "declined" ? request.status : null);
  let approvedBy = "No approval recorded";
  let approvalNote = "";
  if (decision === "approved") approvedBy = request?.decisionBy === "Administrator" ? "Approver name unavailable" : (request?.decisionBy || "Approver not recorded");
  else if (decision === "declined") approvedBy = "Not approved";
  else if (["submitted", "returned", "assigned", "in_progress"].includes(request?.status)) approvedBy = "Awaiting decision";
  if (decision === "approved") approvalNote = formatApprovalTime(request?.reviewed_at);
  else if (!decision && (request?.reviewed_by || request?.reviewed_at)) {
    approvedBy = "Approval outcome not recorded";
    const reviewer = request.reviewed_by ? `Reviewed by ${request.decisionBy && request.decisionBy !== "Administrator" ? request.decisionBy : "name unavailable"}` : "Review recorded";
    approvalNote = [reviewer, formatApprovalTime(request.reviewed_at)].filter(Boolean).join(" · ");
  }

  const fields = [
    { label: "Staff member", value: present(staffName) ? String(staffName) : "Not recorded" },
    { label: "Start date", value: formatRequestDate(details.start_date) },
    { label: "Reason", value: reasonKey ? String(details[reasonKey]) : "Not provided" },
    { label: "End date", value: formatRequestDate(details.end_date) },
    { label: "Approved by", value: approvedBy, note: approvalNote },
  ];
  const displayedKeys = new Set(["start_date", "end_date", reasonKey]);
  const additionalDetails = Object.entries(details)
    .filter(([key, value]) => !displayedKeys.has(key) && value != null && (typeof value === "object" || String(value).trim()))
    .map(([key, value]) => ({
      key,
      label: key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    }));
  return { fields, additionalDetails };
}
