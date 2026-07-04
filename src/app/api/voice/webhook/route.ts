/**
 * Vapi server webhook. We now use a REVIEW-BEFORE-COMMIT flow: after the call the
 * client shows the recap + inferred insights, the user corrects them, and
 * /api/mentor/review is the single path that writes insights to the map.
 *
 * So this webhook no longer auto-extracts/persists — doing so would double-write
 * and bypass the user's corrections. It's kept as a 200-OK acknowledgement (Vapi
 * expects one) and a place to log end-of-call events. If you ever want a
 * server-side fallback for calls where the user closes the tab before reviewing,
 * re-enable insight extraction here behind a flag.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const type = body?.message?.type ?? body?.type;
    console.log("[voice/webhook] event:", type ?? "unknown");
    return NextResponse.json({ ok: true, received: type ?? "unknown" });
  } catch (err) {
    console.error("[voice/webhook]", err);
    return NextResponse.json({ ok: true, error: "logged" });
  }
}
