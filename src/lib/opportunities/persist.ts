/**
 * Store a vectorized role. Hard facts go to columns (SQL-filterable); the full
 * vector + facts blob go to jsonb (for the matcher).
 */
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import type { OpportunityExtraction } from "./schema";

type Source = "greenhouse" | "lever" | "ashby" | "pasted" | "other";

export async function persistOpportunity(opts: {
  extraction: OpportunityExtraction;
  jd: string;
  url?: string | null;
  source?: Source;
  externalId?: string | null;
  addedByProfileId?: string | null;
}) {
  const f = opts.extraction.facts;
  const [row] = await db
    .insert(opportunities)
    .values({
      source: opts.source ?? "pasted",
      externalId: opts.externalId ?? null,
      url: opts.url ?? null,
      company: f.company || null,
      title: f.title || null,
      location: f.location ?? null,
      remote: f.remote,
      compMin: f.comp_min ?? null,
      compMax: f.comp_max ?? null,
      companyStage: f.company_stage,
      domain: f.domain || null,
      rawText: opts.jd,
      vector: opts.extraction.vector,
      facts: f,
      addedByProfileId: opts.addedByProfileId ?? null,
    })
    .returning({ id: opportunities.id });
  return { id: row.id };
}
