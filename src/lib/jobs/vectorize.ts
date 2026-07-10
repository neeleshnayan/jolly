/**
 * The ONE tiered-vectorisation core, shared by the CLI (tools/tiered-revectorize.ts)
 * and the admin dashboard (runInference) so the two can never drift.
 *
 * Strategy: a cheap-fast model (granite) handles the bulk in ~5s; a row is
 * ESCALATED to the strong model (gemma3) when the fast extraction is thin
 * (skills scrubbed to <2), has no real summary, OR the fast model itself flagged
 * the JD as hard (needs_review). The escalation is deliberately OR'd so an
 * overconfident self-report can't hide an objectively thin extraction, and a
 * grounded self-flag catches wrong-but-present output the heuristics miss.
 *
 * Pure functions of the DB + the LLM provider — callers own batching, cooldowns,
 * progress, and the model-resident order (all-fast then all-strong = one swap).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { getProvider } from "@/llm";
import { VECTORIZE_PROMPT, VECTORIZE_PROMPT_VERSION, vectorizeJsonSchema } from "@/agents/opportunity-vectorizer";
import { opportunityExtraction, type OpportunityExtraction, type OpportunityFacts } from "@/lib/opportunities/schema";
import { sanitize } from "@/agents/jd-keywords";
import { embed, roleEmbedText } from "@/lib/embeddings";

// granite4.1:8b was DEMOTED after a vector-flatness audit (2026-07-10): its
// facts were fine but 93% of its 0-1 axis scores landed in [0.55,0.65], 90% of
// rows had near-zero spread, and 5 of 12 axes were dead (req_seniority 0.60
// ±0.017 — the same score for intern and CTO). Ranking runs on the vector, so a
// model that won't commit to a judgment is useless here no matter how fast.
// gemma3 runs end to end (~27s/JD); the tiered seam stays so a future small
// model that PASSES the flatness audit (tools/vector-flatness.ts) can slot back
// into FAST via env without touching code.
export const FAST_MODEL = process.env.VECTORIZE_FAST_MODEL ?? "gemma3:27b";
export const STRONG_MODEL = process.env.VECTORIZE_STRONG_MODEL ?? "gemma3:27b";
/** Models whose stored vectors we currently trust — the backfill redoes any row
 *  stamped by a model NOT in this set (e.g. every granite-era row). */
export const TRUSTED_MODELS = [...new Set([FAST_MODEL, STRONG_MODEL])];
const CTX = Number(process.env.OLLAMA_VECTORIZE_NUM_CTX ?? 16384);
const JD_CHARS = Number(process.env.OLLAMA_VECTORIZE_JD_CHARS ?? 16000);

// schema is pure (no env) → memoize; provider is resolved LAZILY so the CLI can
// set LLM_PROVIDER_VECTORIZE before the first call without an import-order race.
const schema = vectorizeJsonSchema();

/** Run the production extraction on one JD. `model` undefined → provider default. */
export async function extractRole(jd: string, model?: string): Promise<OpportunityExtraction> {
  const res = await getProvider("vectorize").extractStructured({
    schemaName: "vectorize_role",
    jsonSchema: schema,
    prompt: VECTORIZE_PROMPT + (jd ?? "").slice(0, JD_CHARS),
    numCtx: CTX,
    maxTokens: 4500,
    ...(model ? { model } : {}),
    keepAlive: "15m",
  });
  return opportunityExtraction.parse(res.data);
}

/** Scrub skills IN PLACE (drops sentences/traits/degrees/duration, 55-char cap)
 *  and return the surviving must-skill count. */
export function cleanSkills(facts: OpportunityFacts): number {
  const must = sanitize(facts.must_have_skills ?? [], 55);
  facts.must_have_skills = must;
  facts.nice_to_have_skills = sanitize(facts.nice_to_have_skills ?? [], 55);
  return must.length;
}

/** Why the strong model should redo this extraction — null when the fast one is
 *  good enough. Also scrubs skills in place (so a kept row writes the clean set).
 *  The self-flag only escalates when a DIFFERENT model would retry: when
 *  fast === strong, re-asking the same model about the same vague JD produces
 *  the same answer — under prompt v2 that self-flag loop escalated nearly every
 *  row to itself and stalled a whole sweep. The flag is still WRITTEN to facts
 *  either way (it's honest metadata), it just doesn't trigger a redo. */
export function escalationReason(facts: OpportunityFacts): string | null {
  const clean = cleanSkills(facts);
  if (clean < 2) return `${clean} clean skills`;
  if ((facts.summary?.trim().length ?? 0) <= 20) return "thin summary";
  if (facts.needs_review === true && FAST_MODEL !== STRONG_MODEL) {
    return `self-flagged: ${facts.review_reason || "hard JD"}`;
  }
  return null;
}

export type RowMeta = { title: string | null; company: string | null; location: string | null; source: string | null };

/** Board rows: the ATS's own header fields are authoritative; bookmarks (source
 *  "other") only have placeholder title/company, so the extraction wins there. */
export function applyRowAuthority(out: OpportunityExtraction, row: RowMeta): void {
  if (row.source !== "other") {
    out.facts.title = row.title || out.facts.title;
    out.facts.company = row.company || out.facts.company;
    out.facts.location = row.location ?? out.facts.location;
  } else {
    out.facts.title = out.facts.title || row.title || "";
    out.facts.company = out.facts.company || row.company || "";
  }
}

/** Persist an extraction to its row, stamping the model + prompt version and
 *  clearing the escalation flag. The prompt_v stamp is what lets a future
 *  prompt bump re-queue exactly the stale rows and nothing else. */
export async function writeVectorization(id: string, out: OpportunityExtraction, model: string | null, row: RowMeta): Promise<void> {
  const facts = { ...out.facts, prompt_v: VECTORIZE_PROMPT_VERSION };
  // semantic trajectory embedding — generated in the same write so the sweep
  // fills it too. ~50ms; a failure must not lose the (expensive) extraction.
  let embedding: number[] | null = null;
  try { embedding = (await embed([roleEmbedText(out.facts, row.title)]))[0] ?? null; } catch { /* fill later via embed backfill */ }
  await db
    .update(opportunities)
    .set({
      vector: out.vector,
      facts,
      ...(embedding ? { embedding } : {}),
      remote: out.facts.remote ?? undefined,
      compMin: out.facts.comp_min ?? null,
      compMax: out.facts.comp_max ?? null,
      companyStage: out.facts.company_stage,
      domain: out.facts.domain || null,
      vectorizedAt: sql`now()`,
      needsStrongPass: false,
      vectorizeModel: model,
      ...(row.source === "other" ? { title: out.facts.title || row.title, company: out.facts.company || row.company } : {}),
    })
    .where(eq(opportunities.id, id));
}

/** Free a model's VRAM (keep_alive:0) — call between the fast and strong passes. */
export async function unloadModel(model: string): Promise<void> {
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => {});
}
