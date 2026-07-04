/**
 * POST /api/voice/say — TTS only. Used for the mentor's opening line and any
 * "play that again". Body: { text }. Returns base64 audio for the browser to play.
 */
import { NextResponse } from "next/server";
import { synthesize } from "@/lib/voice/voicebox";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { text } = await req.json().catch(() => ({}));
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    const { audio, mime } = await synthesize(text.trim());
    return NextResponse.json({ ok: true, audioBase64: audio.toString("base64"), mime });
  } catch (err) {
    console.error("[/api/voice/say]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
