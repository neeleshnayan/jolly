/**
 * POST /api/admin/refresh-jobs — phase 1 only: pull the ATS boards and store
 * raw postings (no GPU work). Run inference separately via /api/admin/run-inference.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { fetchRawJobs } from "@/lib/jobs/fetch";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const result = await fetchRawJobs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/admin/refresh-jobs]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
