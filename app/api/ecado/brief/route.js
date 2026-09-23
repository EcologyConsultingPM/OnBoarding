/**
 * POST /api/ecado/brief
 *
 * Body: { kind, projectRef?, narrate? }
 *
 * Pipeline: guard -> thresholds -> collect -> classify -> persist
 * escalations -> render (deterministic) -> optional narration -> validate
 * -> audit -> store.
 *
 * The response is useful even if narration fails. That is intentional —
 * the rule-engine output is complete and authoritative on its own.
 */

import { requireEcadoViewerApi, auditEcado } from "../../../../lib/ecado/access";
import { writerClient } from "../../../../lib/ecado/supabase-server";
import { loadThresholds } from "../../../../lib/ecado/thresholds";
import { collectSnapshot, sourcesRead } from "../../../../lib/ecado/collect";
import { classify, filterToProject, filterToCompliance, filterToCapacity } from "../../../../lib/ecado/classify";
import { persistEscalations, staleOpenEscalations } from "../../../../lib/ecado/escalations";
import { render } from "../../../../lib/ecado/render";
import { ECADO_SYSTEM_PROMPT, buildNarrationPrompt, validateNarration, NARRATION_FALLBACK } from "../../../../lib/ecado/prompt";
import { countByRating } from "../../../../lib/ecado/types";
import { sendPortalEmail } from "../../../../lib/transactionalEmail";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const VALID_KINDS = ["daily", "weekly", "project", "capacity", "compliance", "program"];

function sourceSummary(snapshot) {
  return Object.values(snapshot.feeds).map((feed) => ({
    feed: feed.feed,
    table: feed.table,
    rowCount: feed.rows?.length || 0,
    dataCurrentTo: feed.dataCurrentTo,
    state: feed.gap?.reason === "stale" ? "stale" : feed.gap ? "attention" : feed.rows?.length ? "current" : "no_records",
    detail: feed.gap?.detail || (feed.rows?.length ? "Read successfully." : "Read successfully; no current records."),
    requiredFor: feed.gap?.requiredFor || [],
  }));
}

async function narrate(kind, findings, snapshot, subjectRef) {
  const model = process.env.ECADO_MODEL || "claude-sonnet-5";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: null, model, error: "ANTHROPIC_API_KEY not configured." };
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system: ECADO_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildNarrationPrompt(kind, findings, snapshot, subjectRef) }],
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      return { text: null, model, error: `Anthropic API error (${response.status}): ${errorBody.slice(0, 300)}` };
    }
    const data = await response.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

    const problems = validateNarration(text, findings);
    if (problems.length) {
      console.warn("[ecado] narration rejected", problems);
      return { text: null, model, error: `Narration rejected: ${problems.join("; ")}` };
    }
    return { text, model };
  } catch (err) {
    console.error("[ecado] narration failed", err);
    return { text: null, model, error: err.message };
  }
}

export async function POST(request) {
  const guard = await requireEcadoViewerApi(request);
  if (!guard.ok) return guard.response;
  const { viewer } = guard;

  const body = await request.json().catch(() => ({}));
  const kind = VALID_KINDS.includes(body.kind) ? body.kind : "daily";
  const narrateRequested = body.narrate !== false;

  try {
    const writer = writerClient();
    const thresholds = await loadThresholds(writer);
    const snapshot = await collectSnapshot(writer, thresholds);
    const now = new Date();

    let findings = classify(snapshot, thresholds, now);

    if (kind === "project") {
      if (!body.projectRef) return Response.json({ error: "projectRef is required for a project review." }, { status: 400 });
      findings = filterToProject(findings, snapshot, body.projectRef);
    } else if (kind === "compliance") {
      findings = filterToCompliance(findings);
    } else if (kind === "capacity") {
      findings = filterToCapacity(findings);
    }

    const { opened, updated, failures: escalationFailures } = await persistEscalations(findings);
    const stale = kind === "daily" || kind === "weekly" ? await staleOpenEscalations(findings.map((f) => f.fingerprint)) : [];

    let markdown = render(kind, findings, snapshot, stale, body.projectRef ?? null, now);
    let narrated = false;
    let model = null;
    let narrationNote = null;

    if (narrateRequested && process.env.ANTHROPIC_API_KEY && findings.length) {
      const result = await narrate(kind, findings, snapshot, body.projectRef ?? null);
      if (result.text) {
        markdown = `${result.text}\n\n---\n\n${markdown}`;
        narrated = true;
        model = result.model;
      } else {
        markdown = `${NARRATION_FALLBACK}\n\n---\n\n${markdown}`;
        narrationNote = result.error ?? null;
      }
    }

    const counts = countByRating(findings);
    const refreshedSources = sourceSummary(snapshot);

    await writer.from("ecado_briefs").insert({
      kind,
      subject_ref: body.projectRef ?? null,
      generated_by: viewer.email,
      data_current_to: snapshot.dataCurrentTo,
      counts,
      findings,
      markdown,
      model,
      narrated,
    });

    let emailResult = null;
    if (kind === "weekly") {
      try {
        emailResult = await sendPortalEmail({
          request,
          to: viewer.email,
          subject: `Ecado — Weekly Executive Brief (${now.toISOString().slice(0, 10)})`,
          heading: "Your weekly Ecado brief is ready",
          body: `Portfolio, compliance, resource and commercial signals for the week of ${now.toISOString().slice(0, 10)} have been compiled. ${counts?.critical || counts?.high ? `${(counts.critical || 0) + (counts.high || 0)} finding(s) need attention.` : "No findings require immediate attention this week."} Open Ecado for the full brief.`,
          ctaLabel: "Open Ecado",
          ctaPath: "/admin/ecado",
        });
      } catch (error) {
        console.error("Could not email the weekly Ecado brief", error);
        emailResult = { sent: false, reason: "send_failed" };
      }
    }

    await auditEcado(viewer.email, "brief.generate", { kind, counts, gaps: snapshot.gaps.length, sources: refreshedSources.map((source) => ({ feed: source.feed, state: source.state, rowCount: source.rowCount })), escalations: { opened, updated, failed: escalationFailures?.length || 0 }, escalationFailures, narrationNote, emailSent: emailResult?.sent ?? null, emailReason: emailResult?.reason ?? null }, sourcesRead(snapshot));

    return Response.json({
      kind,
      subjectRef: body.projectRef ?? null,
      generatedAt: now.toISOString(),
      counts,
      findings,
      gaps: snapshot.gaps,
      dataCurrentTo: snapshot.dataCurrentTo,
      sources: refreshedSources,
      staleEscalations: stale,
      escalationFailures: escalationFailures?.length ? escalationFailures : undefined,
      markdown,
      narrated,
      model,
      emailSent: emailResult?.sent ?? undefined,
      emailReason: emailResult?.reason ?? undefined,
    });
  } catch (err) {
    console.error("[ecado] brief generation failed", err);
    await auditEcado(viewer.email, "brief.error", { message: err.message });
    return Response.json({ error: "Brief generation failed. The underlying data was not modified." }, { status: 500 });
  }
}
