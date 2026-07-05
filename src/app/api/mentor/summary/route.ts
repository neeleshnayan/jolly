/**
 * POST /api/mentor/summary — the post-call review payload.
 * Given a transcript, returns BOTH a human recap and the structured insights the
 * mentor inferred, WITHOUT persisting anything. The client shows these for the
 * user to correct; only /api/mentor/review commits the approved version.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { insightExtractor } from "@/agents/insight-extractor";
import { summarizeCall } from "@/lib/mentor/summarize";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { transcript, userId } = await req.json().catch(() => ({}));
    if (typeof transcript !== "string" || transcript.trim().length < 20) {
      return NextResponse.json(
        { error: "Transcript too short to summarize" },
        { status: 400 },
      );
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
    const extraction = (
      await runAgent(insightExtractor, { transcript: capped }, { userId: userId ?? "anon" })
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
