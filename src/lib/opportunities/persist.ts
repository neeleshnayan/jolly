/**
 * Store a vectorized role. Hard facts go to columns (SQL-filterable); the full
 * vector + facts blob go to jsonb (for the matcher).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import type { OpportunityExtraction } from "./schema";

type Source = "greenhouse" | "lever" | "ashby" | "pasted" | "sample" | "other";

export async function persistOpportunity(opts: {
  extraction: OpportunityExtraction;
  jd: string;
  url?: string | null;
  source?: Source;
  externalId?: string | null;
  addedByProfileId?: string | null;
}) {
  const f = opts.extraction.facts;
  const values = {
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
  };
  // Upsert on externalId: a role re-pulled from a board updates in place instead
  // of duplicating (nulls stay distinct, so pasted/sample rows always insert).
  // Guards against overlapping fetch runs racing to insert the same posting.
  const insert = db.insert(opportunities).values(values);
  const [row] = await (opts.externalId
    ? insert.onConflictDoUpdate({
        target: opportunities.externalId,
        set: { ...values, createdAt: sql`${opportunities.createdAt}` }, // keep original first-seen time
      })
    : insert
  ).returning({ id: opportunities.id });
  return { id: row.id };
}
