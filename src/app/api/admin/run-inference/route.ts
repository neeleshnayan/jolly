/**
 * POST /api/admin/run-inference — phase 2: vectorize pending jobs on the local
 * model, `batch` at a time with a cooldown between batches so the GPU doesn't
 * cook on a long run. Body: { count?: number } — how many to process this run.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { runInference, inferenceProgress, resetInferenceProgress, recentInferenceActivity } from "@/lib/jobs/fetch";

export const runtime = "nodejs";
export const maxDuration = 600;

/** GET — live progress of the current (or last) inference run. Poll while running.
 *  `activeSecondsAgo` is the DB-evidence signal (survives dev-mode module resets). */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  return NextResponse.json({ ok: true, progress: inferenceProgress(), activeSecondsAgo: await recentInferenceActivity() });
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { count?: number; batch?: number; sleepSec?: number; force?: boolean; tiered?: boolean };
  // bounded but big enough to sweep the whole pool in one request on the local
  // rig (the UI shows the same cap — it used to promise "200" while this
  // silently clamped to 50)
  const limit = Math.min(2000, Math.max(1, body.count ?? 10));
  const batchSize = Math.min(10, Math.max(1, body.batch ?? 5));
  const sleepMs = Math.min(120, Math.max(0, body.sleepSec ?? 30)) * 1000;
  const force = body.force === true; // reprocess already-vectorized rows too
  const tiered = body.tiered !== false; // default on: granite → escalate to gemma3
  if (inferenceProgress().running) {
    return NextResponse.json({ error: "An inference run is already in progress" }, { status: 409 });
  }
  // dev-mode HMR resets the in-memory mutex, so also check the DB evidence: a
  // live run stamps rows continuously. Refuses rather than racing the GPU.
  const activeAgo = await recentInferenceActivity();
  if (activeAgo !== null) {
    return NextResponse.json(
      { error: `A run appears active — a row was vectorized ${activeAgo}s ago. Wait ~3 min after it stops (or after you kill it) and try again.` },
      { status: 409 },
    );
  }
  try {
    const result = await runInference({ limit, batchSize, sleepMs, force, tiered });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    resetInferenceProgress(); // unjam the mutex so the next run can start
    console.error("[/api/admin/run-inference]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
