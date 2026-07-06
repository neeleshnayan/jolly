/**
 * POST /api/opportunities/seed — load the curated sample of roles (idempotent).
 * Instant + deterministic (pre-tuned vectors), so the matcher can be tested
 * without a live JD feed. Safe to call repeatedly.
 */
import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { persistOpportunity } from "@/lib/opportunities/persist";
import { SAMPLE_JOBS, sampleExtraction } from "@/lib/opportunities/samples";

export const runtime = "nodejs";

const extId = (title: string, company: string) => `sample:${title}@${company}`;

export async function POST() {
  try {
    const ids = SAMPLE_JOBS.map((j) => extId(j.title, j.company));
    const existing = await db
      .select({ externalId: opportunities.externalId })
      .from(opportunities)
      .where(inArray(opportunities.externalId, ids));
    const have = new Set(existing.map((e) => e.externalId));

    let seeded = 0;
    for (const j of SAMPLE_JOBS) {
      if (have.has(extId(j.title, j.company))) continue;
      await persistOpportunity({
        extraction: sampleExtraction(j),
        jd: j.jd,
        url: j.url,
        source: "other",
        externalId: extId(j.title, j.company),
      });
      seeded++;
    }
    return NextResponse.json({ ok: true, seeded, total: SAMPLE_JOBS.length });
  } catch (err) {
    console.error("[/api/opportunities/seed]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
