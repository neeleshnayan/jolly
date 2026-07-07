/**
 * Job ingest, split into two phases so the GPU-heavy part is controllable:
 *
 *   fetchRawJobs()  — cheap: pull ATS boards, title-filter, store raw postings
 *                     with vectorizedAt=null (no inference). Safe to run often.
 *   runInference()  — heavy: vectorize the pending rows on the local model, in
 *                     batches with a cooldown between them (thermal headroom).
 *
 * Both the CLI worker and the admin dashboard call these. Pure functions of
 * env + DB — no process.exit, no env mutation; log via callback.
 */
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { runAgent } from "@/agents/run";
import { opportunityVectorizer } from "@/agents/opportunity-vectorizer";
import { releaseLiveModel } from "@/llm/ollama";
import { COMPANIES } from "./companies";
import { fetchBoard } from "./ats";

const DEFAULT_TITLE_FILTER =
  "engineer|developer|research|scientist|founding|technical|product manager|infra|platform|machine learning|\\bai\\b|\\bml\\b|data";
// Hard exclusions beat the include list — "Account Executive, AI Native" and
// "AI Compliance Officer" both contain "AI" but are not builder roles.
const DEFAULT_TITLE_EXCLUDE =
  "account executive|sales|gtm|go.to.market|partnership|business development|recruit|sourcer|counsel|legal|compliance|policy|marketing|brand|communications|finance|accounting|payroll|people ops|talent|administrative|executive assistant|customer success|support";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// what a board tells us WITHOUT inference — enough to show a placeholder card
function guessRemote(location: string | null, title: string): string {
  const s = `${location ?? ""} ${title}`.toLowerCase();
  if (/\bremote\b/.test(s)) return "remote";
  if (/\bhybrid\b/.test(s)) return "hybrid";
  return "unknown";
}

export type FetchResult = { inserted: number; scanned: number; matched: number; log: string[] };

/** Phase 1 — pull boards and store raw postings (no inference). */
export async function fetchRawJobs(opts?: { log?: (line: string) => void }): Promise<FetchResult> {
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    opts?.log?.(s);
  };
  const titleFilter = new RegExp(process.env.JOBS_TITLE_FILTER ?? DEFAULT_TITLE_FILTER, "i");
  const titleExclude = new RegExp(process.env.JOBS_TITLE_EXCLUDE ?? DEFAULT_TITLE_EXCLUDE, "i");

  let inserted = 0;
  let scanned = 0;
  let matched = 0;

  for (const c of COMPANIES) {
    if (!c.slug || c.slug.includes("your")) continue;
    let jobs;
    try {
      jobs = await fetchBoard(c.source, c.slug);
    } catch (e) {
      log(`skip ${c.source}:${c.slug} — ${(e as Error).message}`);
      continue;
    }
    const before = jobs.length;
    jobs = jobs.filter((j) => j.jd.length >= 80 && titleFilter.test(j.title) && !titleExclude.test(j.title));
    scanned += before;
    matched += jobs.length;
    log(`${c.source}:${c.slug} → ${jobs.length} builder roles (of ${before})`);
    if (!jobs.length) continue;

    // skip ones we already have (by external_id) so we don't clobber vectors
    const ids = jobs.map((j) => j.externalId);
    const existing = await db
      .select({ externalId: opportunities.externalId })
      .from(opportunities)
      .where(inArray(opportunities.externalId, ids));
    const have = new Set(existing.map((e) => e.externalId));

    const fresh = jobs.filter((j) => !have.has(j.externalId));
    if (!fresh.length) {
      log(`  (all ${jobs.length} already in DB)`);
      continue;
    }
    // one bulk insert; onConflictDoNothing covers a race with another fetch
    const res = await db
      .insert(opportunities)
      .values(
        fresh.map((j) => ({
          source: c.source,
          externalId: j.externalId,
          url: j.url,
          company: c.slug,
          title: j.title,
          location: j.location,
          remote: guessRemote(j.location, j.title),
          rawText: j.jd,
          vector: {},
          facts: {},
          vectorizedAt: null,
        })),
      )
      .onConflictDoNothing({ target: opportunities.externalId })
      .returning({ id: opportunities.id });
    inserted += res.length;
    log(`  + stored ${res.length} new posting(s)`);
  }

  log(`Fetch done. ${inserted} new posting(s) awaiting inference.`);
  return { inserted, scanned, matched, log: lines };
}

export type InferenceResult = { vectorized: number; failed: number; remaining: number; log: string[] };

/**
 * Phase 2 — vectorize pending rows on the local model. Processes `limit` rows in
 * batches of `batchSize`, sleeping `sleepMs` between batches so the GPU gets
 * thermal headroom on a long run.
 */
export async function runInference(opts?: {
  limit?: number;
  batchSize?: number;
  sleepMs?: number;
  log?: (line: string) => void;
}): Promise<InferenceResult> {
  const limit = opts?.limit ?? Number(process.env.JOBS_INFER_LIMIT ?? 20);
  const batchSize = Math.max(1, opts?.batchSize ?? Number(process.env.JOBS_INFER_BATCH ?? 5));
  const sleepMs = opts?.sleepMs ?? Number(process.env.JOBS_INFER_SLEEP_MS ?? 30000);
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    opts?.log?.(s);
  };

  const pending = await db
    .select()
    .from(opportunities)
    .where(isNull(opportunities.vectorizedAt))
    .orderBy(asc(opportunities.createdAt))
    .limit(limit);

  if (!pending.length) {
    log("Nothing pending — all fetched jobs are already vectorized.");
    return { vectorized: 0, failed: 0, remaining: 0, log: lines };
  }
  // free the voice model's VRAM first — the 27B extractor doesn't fit beside it
  await releaseLiveModel();
  log(`Vectorizing ${pending.length} job(s), ${batchSize} at a time, ${Math.round(sleepMs / 1000)}s cooldown between batches.`);

  let vectorized = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    log(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pending.length / batchSize)}:`);
    for (const row of batch) {
      try {
        const { output } = await runAgent(opportunityVectorizer, { jd: row.rawText ?? "" }, { userId: "worker" });
        // the board's own fields are authoritative for title/company/location
        output.facts.title = row.title || output.facts.title;
        output.facts.company = row.company || output.facts.company;
        output.facts.location = row.location ?? output.facts.location;
        await db
          .update(opportunities)
          .set({
            vector: output.vector,
            facts: output.facts,
            remote: output.facts.remote ?? row.remote,
            compMin: output.facts.comp_min ?? null,
            compMax: output.facts.comp_max ?? null,
            companyStage: output.facts.company_stage,
            domain: output.facts.domain || null,
            vectorizedAt: sql`now()`,
          })
          .where(eq(opportunities.id, row.id));
        vectorized++;
        log(`  + ${row.title}`);
      } catch (e) {
        failed++;
        log(`  ! ${row.title} — ${(e as Error).message}`);
      }
    }
    const more = i + batchSize < pending.length;
    if (more && sleepMs > 0) {
      log(`  …cooling down ${Math.round(sleepMs / 1000)}s`);
      await sleep(sleepMs);
    }
  }

  const [{ n: remaining }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(isNull(opportunities.vectorizedAt));
  log(`Inference done. Vectorized ${vectorized}, failed ${failed}, ${remaining} still pending.`);
  return { vectorized, failed, remaining, log: lines };
}
