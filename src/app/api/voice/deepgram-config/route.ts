/**
 * GET /api/voice/deepgram-config — the Deepgram Voice Agent's think.prompt +
 * greeting, built as drizzle's REAL personalized mentor for the signed-in user.
 * The spike (and later the prod call mode) fetches this so the cloud agent knows
 * who it's talking to.
 */
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { buildDeepgramAgentPrompt } from "@/lib/voice/deepgram-agent";

export const runtime = "nodejs";

export async function GET() {
  const userId = await resolveUserId(null);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { prompt, greeting } = await buildDeepgramAgentPrompt(userId);
    return NextResponse.json({ ok: true, prompt, greeting });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to build prompt" }, { status: 500 });
  }
}
