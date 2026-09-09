import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normaliseHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 750000);
}

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex");
}

// Some government sites (observed: act.gov.au) run bot mitigation that blocks
// a self-identifying compliance-monitor User-Agent outright even though the
// page itself is fully public (it's indexed by ordinary search crawlers).
// Some large reform pages (observed: dcceew.gov.au) occasionally exceed a 20s
// fetch. Try the honest identity first; only on a 403 or timeout, retry once
// as a standard browser UA with a longer timeout before giving up. This never
// changes behaviour for sources that already succeed on the first attempt.
async function fetchSourceWithRetry(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "EcologyConsulting-RegulatoryWatch/1.0 (compliance review monitor)" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) return response;
    if (response.status !== 403) return response;
  } catch (error) {
    if (error?.name !== "TimeoutError" && error?.name !== "AbortError") throw error;
  }
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
    redirect: "follow",
    signal: AbortSignal.timeout(35000),
  });
}

function decodeEntities(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function textFromTag(block, tag) {
  const match = String(block || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? normaliseHtml(decodeEntities(match[1])) : "";
}
function linkFromEntry(block) {
  const href = String(block || "").match(/<link[^>]+href=["']([^"']+)["']/i);
  return href?.[1] || textFromTag(block, "link") || "";
}
function normaliseStructured(raw, type) {
  const source = String(raw || "");
  if (type === "json") {
    try {
      const parsed = JSON.parse(source);
      const items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.entries || parsed.results || [parsed]);
      return JSON.stringify(items.slice(0, 500).map((item) => ({ id: item.id || item.guid || item.url || item.link || "", title: item.title || item.name || "", published: item.updated || item.published || item.date || "", summary: item.summary || item.description || item.content || "" }))).slice(0, 750000);
    } catch { return normaliseHtml(source); }
  }
  if (type === "rss" || type === "atom") {
    const entries = [...source.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
    return entries.slice(0, 500).map((entry) => [textFromTag(entry, "guid") || textFromTag(entry, "id"), textFromTag(entry, "title"), textFromTag(entry, "pubDate") || textFromTag(entry, "updated") || textFromTag(entry, "published"), linkFromEntry(entry), textFromTag(entry, "description") || textFromTag(entry, "summary")].join(" | ")).join("\n").slice(0, 750000);
  }
  return normaliseHtml(source);
}
function sourceTarget(source) { return source.feed_url || source.source_url; }

function sourceDomains(category) {
  if (category === "whs") return ["WHS & EC Forms", "Internal Governance"];
  if (category === "biodiversity") return ["Species Profiles & Survey Requirements", "Projects & Tracker"];
  if (category === "flora_fauna") return ["Species Profiles & Survey Requirements"];
  return ["Projects & Tracker", "Species Profiles & Survey Requirements", "Internal Governance"];
}

function defaultSummary(source) {
  return `The monitored source “${source.title}” changed since its previous successful check. An authorised reviewer must identify the material change, assess operational impact and decide whether staff, procedures, forms, training or project methods require an update.`;
}

function jobAuthorised(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  return Boolean(secret) && supplied === `Bearer ${secret}`;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Regulatory Watch requires Supabase server credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function notifyApprovedAdmins(admin, title, body, sourceId) {
  const [{ data: users, error: usersError }, { data: adminEmails, error: adminEmailsError }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("admin_emails").select("email"),
  ]);
  if (usersError) throw new Error(usersError.message);
  if (adminEmailsError) throw new Error(adminEmailsError.message);
  const approvedEmails = new Set((adminEmails || []).map((row) => String(row.email || "").toLowerCase()));
  const recipients = (users?.users || []).filter((user) => approvedEmails.has(String(user.email || "").toLowerCase()));
  if (!recipients.length) return;
  const { error } = await admin.from("portal_events").insert(recipients.map((user) => ({
    recipient_id: user.id,
    event_type: "regulatory_source_health",
    severity: "warning",
    title,
    body,
    href: "/?portal=admin&area=regulatorywatch",
    source_table: "regulatory_sources",
    source_id: sourceId,
  })));
  if (error) throw new Error(error.message);
}

// Vercel Cron (or another authenticated scheduler) calls this endpoint. It only
// creates an admin review item for a changed official source; it never rewrites
// requirements, notifies staff or changes controlled documents automatically.
export async function GET(request) {
  if (!jobAuthorised(request)) return Response.json({ error: "Unauthorised scheduler." }, { status: 401 });
  try {
    const admin = adminClient();
    const { data: sources, error } = await admin.from("regulatory_sources").select("*").eq("active", true).order("title");
    if (error) throw new Error(error.message);

    const outcomes = [];
    for (const source of sources || []) {
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetchSourceWithRetry(sourceTarget(source));
        const raw = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const digest = fingerprint(normaliseStructured(raw, source.fetch_type || "page"));
        const versionValue = response.headers.get("etag") || response.headers.get("last-modified") || digest;
        const changed = Boolean(source.last_fingerprint && source.last_fingerprint !== digest);

        if (changed) {
          const { data: update, error: insertError } = await admin.from("regulatory_updates").insert({
            source_id: source.id,
            title: `Review required: ${source.title}`,
            summary: defaultSummary(source),
            source_url: sourceTarget(source),
            fingerprint: digest,
            affected_domains: sourceDomains(source.category),
            severity: "review",
            status: "new",
          }).select("id, title, summary, severity").single();
          // A duplicate fingerprint means the same detected update is already
          // awaiting review; it is deliberately not duplicated.
          if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
          if (update) {
            const [{ data: users, error: usersError }, { data: adminEmails, error: adminEmailsError }] = await Promise.all([
              admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
              admin.from("admin_emails").select("email"),
            ]);
            if (usersError) throw new Error(usersError.message);
            if (adminEmailsError) throw new Error(adminEmailsError.message);
            const approvedEmails = new Set((adminEmails || []).map((row) => String(row.email || "").toLowerCase()));
            const recipients = (users?.users || []).filter((user) => approvedEmails.has(String(user.email || "").toLowerCase()));
            if (recipients.length) {
              const { error: eventError } = await admin.from("portal_events").insert(recipients.map((user) => ({
                recipient_id: user.id,
                event_type: "regulatory_update",
                severity: "review",
                title: `Regulatory review required: ${update.title.replace("Review required: ", "")}`,
                body: update.summary,
                href: "/?portal=admin&area=whsmonitor&tab=regulatory-watch",
                source_table: "regulatory_updates",
                source_id: update.id,
              })));
              if (eventError) throw new Error(eventError.message);
            }
          }
        }

        const { error: sourceError } = await admin.from("regulatory_sources").update({
          last_checked_at: checkedAt,
          last_http_status: response.status,
          last_fingerprint: digest,
          last_error: null,
          last_successful_check_at: checkedAt,
          failure_count: 0,
          version_value: versionValue,
          next_retry_at: null,
          updated_at: checkedAt,
        }).eq("id", source.id);
        if (sourceError) throw new Error(sourceError.message);
        await admin.from("regulatory_source_health_alerts").update({ status: "resolved", resolved_at: checkedAt, updated_at: checkedAt }).eq("source_id", source.id).eq("status", "open");
        outcomes.push({ source: source.source_key, changed, ok: true, failure_count: 0 });
      } catch (sourceError) {
        const { data: sourceState } = await admin.from("regulatory_sources").select("failure_count").eq("id", source.id).maybeSingle();
        const failureCount = Number(sourceState?.failure_count || 0) + 1;
        await admin.from("regulatory_sources").update({
          last_checked_at: checkedAt,
          last_http_status: null,
          last_error: String(sourceError.message || "Source check failed").slice(0, 1000),
          failure_count: failureCount,
          next_retry_at: new Date(Date.now() + Math.min(failureCount, 6) * 60 * 60 * 1000).toISOString(),
          updated_at: checkedAt,
        }).eq("id", source.id);
        const { data: openAlert } = await admin.from("regulatory_source_health_alerts").select("id").eq("source_id", source.id).eq("status", "open").maybeSingle();
        if (!openAlert) {
          const { data: createdAlert, error: alertError } = await admin.from("regulatory_source_health_alerts").insert({ source_id: source.id, status: "open", error_message: String(sourceError.message || "Source check failed").slice(0, 1000), last_notified_at: checkedAt }).select("id").single();
          if (alertError && alertError.code !== "23505") throw new Error(alertError.message);
          if (createdAlert) await notifyApprovedAdmins(admin, `Regulatory source unavailable: ${source.title}`, `Regulatory Watch could not check ${source.title}. Error: ${sourceError.message}. The source will be retried on the next scheduled run.`, source.id);
        } else {
          await admin.from("regulatory_source_health_alerts").update({ error_message: String(sourceError.message || "Source check failed").slice(0, 1000), last_seen_at: checkedAt, updated_at: checkedAt }).eq("id", openAlert.id);
        }
        outcomes.push({ source: source.source_key, changed: false, ok: false, failure_count: failureCount, error: sourceError.message });
      }
    }
    return Response.json({ ok: true, checked_at: new Date().toISOString(), outcomes });
  } catch (error) {
    return Response.json({ error: error.message || "Regulatory Watch scan failed." }, { status: 500 });
  }
}
  
