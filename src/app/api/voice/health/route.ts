/**
 * GET /api/voice/health — the mentor-call debug panel's data: is every piece of
 * the voice stack actually alive RIGHT NOW?
 *   voicebox — /health (STT+TTS server)
 *   ollama   — reachable, live model present, and a real timed micro-generation
 * Cheap enough to hit on demand; each probe has its own timeout so one dead
 * component can't hang the whole check.
 */
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 30;

const VOICEBOX = process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493";
const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

async function probe<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T | { error: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fn(ctl.signal);
  } catch (e) {
    return { error: e instanceof Error ? (e.name === "AbortError" ? `no response in ${timeoutMs}ms` : e.message) : "failed" };
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  // internal stack topology — signed-in users only
  if (!(await resolveUserId(null))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const liveModel = process.env.OLLAMA_LIVE_MODEL ?? process.env.OLLAMA_MODEL ?? "?";
  const mentorProvider = (process.env.LLM_PROVIDER_MENTOR ?? process.env.LLM_PROVIDER ?? "ollama").toLowerCase();

  const [voicebox, tags, gen] = await Promise.all([
    probe(async (signal) => {
      const r = await fetch(`${VOICEBOX}/health`, { signal });
      const j = (await r.json()) as { status?: string; model_loaded?: boolean; gpu_type?: string; vram_used_mb?: number };
      return { up: r.ok && j.status === "healthy", modelLoaded: !!j.model_loaded, gpu: j.gpu_type ?? "?", vramMb: Math.round(j.vram_used_mb ?? 0) };
    }, 4000),
    probe(async (signal) => {
      const r = await fetch(`${OLLAMA}/api/tags`, { signal });
      const j = (await r.json()) as { models?: { name: string }[] };
      const names = (j.models ?? []).map((m) => m.name);
      return { up: r.ok, liveModelPulled: names.includes(liveModel), models: names.length };
    }, 4000),
    // a real timed micro-turn on the live model — proves the whole LLM leg,
    // including that thinking is off (a think-stall shows up as huge latency)
    probe(async (signal) => {
      const t0 = Date.now();
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: liveModel,
          stream: false,
          think: false,
          keep_alive: "5m",
          options: { num_predict: 8 },
          messages: [{ role: "user", content: "Say OK." }],
        }),
        signal,
      });
      const j = (await r.json()) as { message?: { content?: string }; eval_count?: number };
      return { ok: r.ok, latencyMs: Date.now() - t0, reply: (j.message?.content ?? "").slice(0, 40), tokens: j.eval_count ?? 0 };
    }, 20000),
  ]);

  return NextResponse.json({
    ok: true,
    config: { liveModel, mentorProvider },
    voicebox,
    ollama: tags,
    generation: gen,
    checkedAt: new Date().toISOString(),
  });
}
