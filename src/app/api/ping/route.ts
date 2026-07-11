import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Featherweight keep-warm endpoint. No DB, no imports, no work — its only job is
 * to exercise the OpenNext/Next.js Worker so the free-tier isolate stays WARM.
 * A cold isolate's first hit hangs (the 10ms-CPU cold-start blows the limit), so
 * the client KeepWarm heartbeat pings this every ~20s to hold the isolate open
 * through a demo. See docs/adr-001-ranking-funnel.md + the CF ranking memory.
 */
export async function GET() {
  return NextResponse.json({ ok: true, t: Date.now() });
}
