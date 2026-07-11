/**
 * POST /api/mentor/summary — the post-call review payload.
 * Given a transcript, returns BOTH a human recap and the structured insights the
 * mentor inferred, WITHOUT persisting anything. The client shows these for the
 * user to correct; only /api/mentor/review commits the approved version.
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { insights as insightsTable, profiles } from "@/db/schema";
import { runAgent } from "@/agents/run";
import { insightExtractor } from "@/agents/insight-extractor";
import { summarizeCall } from "@/lib/mentor/summarize";
import { releaseLiveModel } from "@/llm/ollama";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { transcript } = body;
    // no writes here, but it burns local GPU — signed-in users only
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof transcript !== "string" || transcript.trim().length < 20) {
      return NextResponse.json(
        { error: "Transcript too short to summarize" },
        { status: 400 },
      );
    }
    // The USER must have actually said something. The mentor's own lines alone
    // (a greeting to a silent room) once produced a fully hallucinated recap.
    const userSaid = transcript
      .split("\n")
      .filter((l: string) => /^\s*you\s*:/i.test(l))
      .join(" ")
      .replace(/^\s*you\s*:/i, "")
      .trim();
    if (userSaid.length < 30) {
      return NextResponse.json({ ok: true, summary: "", insights: [], silent: true });
    }

    // Cap very long transcripts so the KV cache can't blow VRAM. Keep the most
    // recent turns (where conclusions land) plus a marker.
    const MAX = 10000;
    const capped =
      transcript.length > MAX
        ? `…(earlier part of the conversation omitted)…\n${transcript.slice(-MAX)}`
        : transcript;

    // SEQUENTIAL, not parallel: summarize (qwen3:8b) and insight-extract
    // (gemma3:27b) use different models — loading both at once OOMs the GPU on a
    // long call. One at a time keeps VRAM in budget.
    const summary = await summarizeCall(capped);
    // evict the live model BEFORE the 27B loads — its 5m keep_alive otherwise
    // holds VRAM and the big model OOMs ("cudaMalloc failed" post-call)
    await releaseLiveModel();
    // reconcile-on-extract: hand the extractor what we already know so it can
    // reinforce/refine/contradict instead of just piling on (best-effort).
    let currentInsights: { id: string; dimension: string; content: string }[] = [];
    try {
      const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
      if (p) {
        currentInsights = await db
          .select({ id: insightsTable.id, dimension: insightsTable.dimension, content: insightsTable.content })
          .from(insightsTable)
          .where(and(eq(insightsTable.profileId, p.id), eq(insightsTable.status, "active")));
      }
    } catch {
      /* reconciliation is best-effort — fall back to plain extraction */
    }
    const extraction = (
      await runAgent(insightExtractor, { transcript: capped, currentInsights }, { userId: userId ?? "anon" })
    ).output;

    return NextResponse.json({ ok: true, summary, insights: extraction.insights });
  } catch (err) {
    console.error("[/api/mentor/summary]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
