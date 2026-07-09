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
  // comp columns are integers; extraction sometimes returns decimals (hourly
  // rates like 53.37) which Postgres rejects outright — round, don't lose the row
  const toInt = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  const values = {
    source: opts.source ?? "pasted",
    externalId: opts.externalId ?? null,
    url: opts.url ?? null,
    company: f.company || null,
    title: f.title || null,
    location: f.location ?? null,
    remote: f.remote,
    compMin: toInt(f.comp_min),
    compMax: toInt(f.comp_max),
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
