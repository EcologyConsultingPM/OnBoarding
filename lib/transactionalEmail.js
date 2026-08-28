const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applicationUrl(request, path = "/") {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return new URL(path, configured).toString();
  try {
    return new URL(path, new URL(request.url).origin).toString();
  } catch {
    return path;
  }
}

/**
 * Sends an optional transactional portal email. It is deliberately a no-op
 * until production has a Resend API key and an approved sender address.
 * Portal database events remain the source of truth and never depend on email.
 */
export async function sendPortalEmail({ request, to, subject, heading, body, ctaLabel, ctaPath }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM_EMAIL || "").trim();
  const recipient = String(to || "").trim();
  if (!apiKey || !from || !recipient) {
    return { sent: false, reason: "not_configured" };
  }

  const actionUrl = ctaPath ? applicationUrl(request, ctaPath) : "";
  const safeHeading = escapeHtml(heading || subject);
  const safeBody = escapeHtml(body).replaceAll("\n", "<br />");
  const safeCta = escapeHtml(ctaLabel || "Open Staff Portal");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4ed;color:#173526;font-family:Arial,sans-serif"><main style="max-width:620px;margin:0 auto;padding:30px"><section style="overflow:hidden;border:1px solid #d7c47a;border-radius:18px;background:#083e2a"><header style="padding:28px 30px;background:linear-gradient(120deg,#04291c,#0f603d);color:#fff"><p style="margin:0 0 9px;color:#e8cc7a;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Ecology Consulting</p><h1 style="margin:0;font-family:Georgia,serif;font-size:27px;font-weight:500">${safeHeading}</h1></header><div style="padding:28px 30px;color:#f1f7ed;font-size:16px;line-height:1.6"><p style="margin:0">${safeBody}</p>${actionUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 17px;border-radius:9px;background:#d9bd63;color:#143523;font-weight:700;text-decoration:none">${safeCta}</a></p>` : ""}<p style="margin:26px 0 0;color:#c8d9cc;font-size:13px">This is an operational notification from the Ecology Consulting Staff Portal.</p></div></section></main></body></html>`;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: String(subject || "Ecology Consulting Staff Portal"),
        html,
        text: `${heading || subject}\n\n${body || ""}${actionUrl ? `\n\n${ctaLabel || "Open Staff Portal"}: ${actionUrl}` : ""}`,
      }),
    });
    if (!response.ok) {
      console.error("Portal email was rejected", await response.text());
      return { sent: false, reason: "provider_rejected" };
    }
    return { sent: true };
  } catch (error) {
    console.error("Portal email could not be sent", error);
    return { sent: false, reason: "provider_unavailable" };
  }
}
