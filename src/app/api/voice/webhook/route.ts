/**
 * Vapi server webhook. On end-of-call we take the transcript, run the
 * insight-extractor agent, and write the results onto the map. This is the
 * moment voice becomes lasting understanding.
 *
 * NOTE: Vapi's exact payload shape should be confirmed against your dashboard's
 * webhook logs — the userId is read from call metadata (set when the call
 * starts) with a couple of fallbacks.
 */
import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { insightExtractor } from "@/agents/insight-extractor";
import { ensureProfile } from "@/lib/profile/ensure";
import { persistInsights } from "@/lib/insights/persist";

export const runtime = "nodejs";
export const maxDuration = 60;

interface VapiTurn {
  role?: string;
  message?: string;
  content?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body?.message ?? body;
    const type = message?.type;

    // We only act on the end-of-call report.
    if (type !== "end-of-call-report" && type !== "end-of-call") {
      return NextResponse.json({ ok: true, ignored: type ?? "unknown" });
    }

    const userId: string | undefined =
      message?.call?.metadata?.userId ??
      message?.assistant?.metadata?.userId ??
      body?.call?.metadata?.userId;

    const transcript: string =
      typeof message?.transcript === "string" && message.transcript.length > 0
        ? message.transcript
        : Array.isArray(message?.messages)
          ? message.messages
              .map((m: VapiTurn) => `${m.role ?? "?"}: ${m.message ?? m.content ?? ""}`)
              .join("\n")
          : "";

    if (!userId || transcript.trim().length < 20) {
      return NextResponse.json({ ok: true, skipped: "missing userId or transcript" });
    }

    const profileId = await ensureProfile(userId);
    const { output } = await runAgent(
      insightExtractor,
      { transcript },
      { userId, profileId },
    );
    const result = await persistInsights({ userId, extraction: output, transcript });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[voice/webhook]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
