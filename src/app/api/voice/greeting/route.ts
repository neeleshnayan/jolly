/**
 * POST /api/voice/greeting — the mentor's opening line, personalized from the
 * user's map. Text only; audio is streamed separately via /api/voice/stream.
 */
import { NextResponse } from "next/server";
import { mentorOpener } from "@/agents/mentor/opener";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // reads the user's map — session-first, dev param only outside production
    const userId = await resolveUserId(typeof body.userId === "string" ? body.userId : null);
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
