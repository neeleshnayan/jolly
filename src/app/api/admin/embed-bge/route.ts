/**
 * Admin: bge-m3 pool embedding (local ollama). GET returns the two backlog
 * counts the control room shows; POST embeds a bounded batch (bounded so a long
 * run doesn't cook the GPU / hit any cap, and so the UI can loop until drained).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { bgeCounts, runBgeEmbed } from "@/lib/jobs/embed-bge";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await bgeCounts()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { count?: number };
  const limit = Math.min(500, Math.max(1, body.count ?? 100));
  try {
    return NextResponse.json({ ok: true, ...(await runBgeEmbed({ limit })) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
