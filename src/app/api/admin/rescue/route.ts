/**
 * POST /api/admin/rescue — the live-demo lifeline. Bottles the GPU-stack
 * rescue ladder (2026-07-09 incident) into one endpoint so a wedged model
 * never kills a demo:
 *
 *   1. evict the stock Ollama squatter on :11434 (tray autostart)
 *   2. test a real generation on the rc server (:11500)
 *   3. if it fails → restart the rc Ollama, test again
 *   4. if it STILL fails → restart voicebox (a zombie voicebox-server-cuda
 *      blocks NEW CUDA contexts machine-wide — the actual culprit last time)
 *   5. warm the live model so the next call turn is instant
 *
 * LOCAL-ONLY, triple-gated: dev build + admin session + localhost request.
 * It shells out to Windows process control — exactly why it must never
 * exist in a hosted deployment.
 */
import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const OLLAMA = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11500";
const MODEL = process.env.OLLAMA_LIVE_MODEL ?? process.env.OLLAMA_MODEL ?? "gemma4:latest";
const RC_EXE = process.env.OLLAMA_RC_EXE ?? `${process.env.USERPROFILE}\\.drizzle\\ollama-rc\\ollama.exe`;
const VOICEBOX_EXE = process.env.VOICEBOX_EXE ?? "C:\\Program Files\\Voicebox\\voicebox.exe";

const ps = (cmd: string, timeoutMs = 60000) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => {
    exec(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function portUp(port: number): Promise<boolean> {
  const r = await ps(`(Test-NetConnection 127.0.0.1 -Port ${port} -WarningAction SilentlyContinue).TcpTestSucceeded`, 15000);
  return /True/i.test(r.out);
}

/** The truth test: can the rc server actually GENERATE on this model? */
async function testGenerate(timeoutMs = 90000): Promise<{ ok: boolean; ms?: number; error?: string }> {
  const started = Date.now();
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt: "Say OK.", stream: false, keep_alive: "10m", options: { num_predict: 4 } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, error: (await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}` };
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "generate failed" };
  }
}

async function evictStock(log: string[]) {
  if (!(await portUp(11434))) {
    log.push("• :11434 free — no stock Ollama squatter");
    return;
  }
  await ps(`Get-Process 'ollama app' -ErrorAction SilentlyContinue | Stop-Process -Force; $c = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }`);
  log.push("• evicted stock Ollama from :11434 (+ tray app)");
}

async function restartOllama(log: string[]) {
  await ps(`$c = Get-NetTCPConnection -LocalPort 11500 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }`);
  await sleep(2000);
  // killing the listener ORPHANS its llama-server runners — they keep holding
  // VRAM + a CUDA context (the exact wedge this rescue exists for). Sweep them
  // before starting fresh, or the new server inherits a wedged GPU.
  await ps(`Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force`);
  // GGML_CUDA_NO_PINNED: without it the runner pins ~weights-size of host RAM
  // ("shared GPU memory") — this box needs its RAM more than fast model loads
  await ps(`$env:OLLAMA_HOST='127.0.0.1:11500'; $env:OLLAMA_MAX_LOADED_MODELS='1'; $env:GGML_CUDA_NO_PINNED='1'; Start-Process -FilePath '${RC_EXE}' -ArgumentList 'serve' -WindowStyle Hidden`);
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    if (await portUp(11500)) {
      log.push("• rc Ollama restarted on :11500");
      return;
    }
  }
  log.push("! rc Ollama did not come back on :11500 — check ~\\.drizzle\\ollama-rc");
}

async function restartVoicebox(log: string[]) {
  await ps(`Get-Process voicebox*, Voicebox -ErrorAction SilentlyContinue | Stop-Process -Force`);
  await sleep(2000);
  await ps(`Start-Process -FilePath '${VOICEBOX_EXE}'`);
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if (await portUp(17493)) {
      log.push("• voicebox restarted on :17493 (fresh CUDA state)");
      return;
    }
  }
  log.push("! voicebox did not come back on :17493 within 60s");
}

async function warm(log: string[]) {
  const g = await testGenerate(120000);
  log.push(g.ok ? `• live model warm — generation OK in ${((g.ms ?? 0) / 1000).toFixed(1)}s` : `! warm-up generation failed: ${g.error}`);
  try {
    await fetch(`${process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493"}/health`, { signal: AbortSignal.timeout(8000) });
    log.push("• voicebox reachable");
  } catch {
    log.push("! voicebox /health unreachable");
  }
}

export async function POST(req: NextRequest) {
  // triple gate: never in a hosted build, never unauthenticated, never remote
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return NextResponse.json({ error: "Local only" }, { status: 403 });

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const log: string[] = [];

  try {
    switch (action) {
      case "evict-stock":
        await evictStock(log);
        break;
      case "restart-ollama":
        await restartOllama(log);
        await warm(log);
        break;
      case "restart-voicebox":
        await restartVoicebox(log);
        break;
      case "warm":
        await warm(log);
        break;
      case "full": {
        log.push("🚑 running the full rescue ladder…");
        await evictStock(log);
        let g = await testGenerate();
        if (g.ok) {
          log.push(`• generation already healthy (${((g.ms ?? 0) / 1000).toFixed(1)}s) — nothing wedged`);
        } else {
          log.push(`• generation failing: ${g.error}`);
          await restartOllama(log);
          g = await testGenerate();
          if (g.ok) {
            log.push(`• fixed by Ollama restart (${((g.ms ?? 0) / 1000).toFixed(1)}s)`);
          } else {
            log.push("• still failing → restarting voicebox (zombie CUDA state blocks new GPU contexts)");
            await restartVoicebox(log);
            g = await testGenerate();
            log.push(g.ok ? `• FIXED after voicebox restart (${((g.ms ?? 0) / 1000).toFixed(1)}s)` : `! still failing after full ladder: ${g.error} — a reboot may be needed`);
          }
        }
        await warm(log);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, log });
  } catch (err) {
    log.push(`! rescue error: ${err instanceof Error ? err.message : "unknown"}`);
    return NextResponse.json({ ok: false, log }, { status: 500 });
  }
}
