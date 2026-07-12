/**
 * POST /api/voice/warmup — called when the call page loads. Preloads the three
 * models (Ollama live model, Whisper, kokoro) into VRAM so the first real turn
 * of the call is fast instead of eating a cold start. Best-effort and idempotent.
 */
import { NextResponse } from "next/server";
import { warmVoice } from "@/lib/voice";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 60;

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const LIVE_MODEL = process.env.OLLAMA_LIVE_MODEL ?? "qwen3:8b";
const LIVE_KEEP_ALIVE = process.env.OLLAMA_LIVE_KEEP_ALIVE ?? "5m";

export async function POST(req: Request) {
  // loads models into VRAM — signed-in users only (body userId is the
  // standard dev-only fallback; without it, dev ?u= rehearsal calls were
  // silently skipping warmup and eating the ~10s cold start on turn one)
  const body = await req.json().catch(() => ({}));
  if (!(await resolveUserId(typeof body.userId === "string" ? body.userId : null))) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Deepgram warms its own agent on connect — skip the ollama/whisper/kokoro
  // preload entirely. This is the local turn-based (MentorCall) path's optimisation
  // only; on the Deepgram/CF path it just makes stray voicebox/OpenRouter calls.
  if ((process.env.VOICE_PROVIDER ?? "").toLowerCase() === "deepgram" || process.env.DEPLOY_TARGET === "cloudflare") {
    return NextResponse.json({ ok: true, skipped: "deepgram" });
  }
  await Promise.allSettled([
    // load the live model without generating (Ollama loads on an empty request)
    fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: LIVE_MODEL, keep_alive: LIVE_KEEP_ALIVE }),
    }).catch(() => {}),
    warmVoice(),
  ]);
  return NextResponse.json({ ok: true });
}
