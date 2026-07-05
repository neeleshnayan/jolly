/**
 * POST /api/voice/greeting — the mentor's opening line, personalized from the
 * user's map. Text only; audio is streamed separately via /api/voice/stream.
 */
import { NextResponse } from "next/server";
import { mentorOpener } from "@/agents/mentor/opener";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { userId } = await req.json().catch(() => ({}));
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    const text = await mentorOpener(userId);
    return NextResponse.json({ ok: true, text });
  } catch (err) {
    console.error("[/api/voice/greeting]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
