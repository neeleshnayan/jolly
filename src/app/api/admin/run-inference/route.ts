/**
 * POST /api/admin/run-inference — phase 2: vectorize pending jobs on the local
 * model, `batch` at a time with a cooldown between batches so the GPU doesn't
 * cook on a long run. Body: { count?: number } — how many to process this run.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { runInference, inferenceProgress, resetInferenceProgress } from "@/lib/jobs/fetch";

export const runtime = "nodejs";
export const maxDuration = 600;

/** GET — live progress of the current (or last) inference run. Poll while running. */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  return NextResponse.json({ ok: true, progress: inferenceProgress() });
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { count?: number; batch?: number; sleepSec?: number };
  const limit = Math.min(50, Math.max(1, body.count ?? 10)); // keep one request bounded
  const batchSize = Math.min(10, Math.max(1, body.batch ?? 5));
  const sleepMs = Math.min(120, Math.max(0, body.sleepSec ?? 30)) * 1000;
  if (inferenceProgress().running) {
    return NextResponse.json({ error: "An inference run is already in progress" }, { status: 409 });
  }
  try {
    const result = await runInference({ limit, batchSize, sleepMs });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    resetInferenceProgress(); // unjam the mutex so the next run can start
    console.error("[/api/admin/run-inference]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
