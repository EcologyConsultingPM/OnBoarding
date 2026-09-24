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
 * Produces a deliberately conservative, email-client-safe notification. The
 * visual treatment relies on nested presentation tables, solid fills and
 * inline styles only: Outlook and webmail clients commonly ignore modern
 * layout primitives, gradients and inherited font colours.
 */
export function renderPortalEmail({ heading, body, ctaLabel, actionUrl, subject }) {
  const safeHeading = escapeHtml(heading || subject || "Ecology Consulting Staff Portal");
  const safeBody = escapeHtml(body || "").replaceAll("\n", "<br />");
  const safeCta = escapeHtml(ctaLabel || "Open Staff Portal");
  const safeActionUrl = actionUrl ? escapeHtml(actionUrl) : "";

  const actionBlock = safeActionUrl ? `
    <tr>
      <td style="padding:0 36px 30px 36px;background-color:#ffffff;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
          <tr>
            <td align="center" bgcolor="#a67418" style="border:1px solid #865b0f;border-radius:7px;background-color:#a67418;">
              <a href="${safeActionUrl}" style="display:inline-block;padding:13px 20px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-align:center;text-decoration:none;">${safeCta}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${safeHeading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f2f4ef;color:#1e2e26;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f4ef" style="width:100%;margin:0;padding:0;background-color:#f2f4ef;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;border-collapse:separate;border-spacing:0;background-color:#ffffff;border:1px solid #cbd8cb;border-radius:12px;overflow:hidden;">
            <tr>
              <td bgcolor="#123b2a" style="padding:30px 36px 28px 36px;background-color:#123b2a;">
                <p style="margin:0 0 11px 0;color:#f5d278;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.25px;line-height:16px;text-transform:uppercase;">Ecology Consulting</p>
                <h1 style="margin:0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:600;line-height:36px;">${safeHeading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 36px 22px 36px;background-color:#ffffff;color:#1e2e26;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;">
                <p style="margin:0;color:#1e2e26;">${safeBody}</p>
              </td>
            </tr>${actionBlock}
            <tr>
              <td style="padding:20px 36px;background-color:#e7eee7;border-top:1px solid #cbd8cb;color:#40564a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">
                This is an operational notification from the Ecology Consulting Staff Portal. Please do not reply to this email.
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;color:#596b60;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;">Ecology Consulting Staff Portal</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
  const html = renderPortalEmail({ heading, body, ctaLabel, actionUrl, subject });

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
        text: `${heading || subject}\n\n${body || ""}${actionUrl ? `\n\n${ctaLabel || "Open Staff Portal"}: ${actionUrl}` : ""}\n\nThis is an operational notification from the Ecology Consulting Staff Portal. Please do not reply to this email.`,
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
