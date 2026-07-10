/** Who gets a re-swing and why — the backfill predicate, itemized.
 *  npx tsx tools/redo-ledger.ts */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, ne } = await import("drizzle-orm");
  const { VECTORIZE_PROMPT_VERSION } = await import("../src/agents/opportunity-vectorizer");
  const PV = VECTORIZE_PROMPT_VERSION;
  const [r] = await db
    .select({
      pending: sql<number>`count(*) filter (where vectorized_at is null)::int`,
      granite: sql<number>`count(*) filter (where vectorize_model = 'granite4.1:8b')::int`,
      unstamped: sql<number>`count(*) filter (where vectorized_at is not null and vectorize_model is null)::int`,
      gemma_old_schema: sql<number>`count(*) filter (where vectorize_model = 'gemma3:27b' and not jsonb_exists(facts, 'needs_review'))::int`,
      gemma_old_prompt: sql<number>`count(*) filter (where vectorize_model = 'gemma3:27b' and jsonb_exists(facts, 'needs_review') and coalesce((facts ->> 'prompt_v')::int, 1) <> ${PV})::int`,
      gemma_final: sql<number>`count(*) filter (where vectorize_model = 'gemma3:27b' and jsonb_exists(facts, 'needs_review') and coalesce((facts ->> 'prompt_v')::int, 1) = ${PV})::int`,
    })
    .from(opportunities)
    .where(ne(opportunities.source, "sample"));
  const redo = r.pending + r.granite + r.unstamped + r.gemma_old_schema + r.gemma_old_prompt;
  console.log(`prompt version: v${PV}\n`);
  console.log(`REDO QUEUE (${redo} total):`);
  console.log(`  pending (never vectorized):        ${r.pending}`);
  console.log(`  granite-era (flat vectors):        ${r.granite}   — excluded from ranking meanwhile`);
  console.log(`  unstamped (old gemma4/laguna era): ${r.unstamped}   — excluded from ranking meanwhile`);
  console.log(`  gemma3, pre-schema facts:          ${r.gemma_old_schema}   — still RANKS meanwhile (vectors were fine)`);
  console.log(`  gemma3, old prompt (< v${PV}):        ${r.gemma_old_prompt}   — still RANKS meanwhile (rubric refresh)`);
  console.log(`FINAL (gemma3 @ v${PV}, never touched again): ${r.gemma_final}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
