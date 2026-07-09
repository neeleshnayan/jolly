/**
 * Re-vectorize the already-vectorized pool with the FINAL extraction structure
 * (comp_currency, min_years_experience, required_credentials). Chunked so the
 * dashboard stays populated: each pass flips 25 rows back to pending and
 * immediately re-runs inference on them (oldest extraction first).
 *   npx tsx tools/revectorize.ts
 * Safe on the 15GB box: gemma4 only, one row at a time, cooldowns between
 * batches, OLLAMA_MAX_LOADED_MODELS=1 on the server.
 */
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0];
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      const hash = v.indexOf(" #");
      if (hash >= 0) v = v.slice(0, hash).trim();
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const BATCH = 5; // rows between cooldowns
const COOLDOWN_MS = 15000;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

async function main() {
  loadEnvLocal();
  process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  // --model=gemma3:27b to re-vectorise with the bake-off winner. Keep it WARM
  // across rows (default keep_alive is 0 = unload after each → a 17GB reload
  // per row). --limit caps the run for a validation pass.
  const model = arg("model");
  if (model) process.env.OLLAMA_MODEL = model;
  process.env.OLLAMA_EXTRACT_KEEP_ALIVE = arg("keepAlive") ?? "15m";
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  console.log(`Model: ${process.env.OLLAMA_MODEL} · keep_alive: ${process.env.OLLAMA_EXTRACT_KEEP_ALIVE}${Number.isFinite(limit) ? ` · limit: ${limit}` : ""}`);
  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { and, asc, eq, isNotNull, lt, ne, sql } = await import("drizzle-orm");
  const { runAgent } = await import("@/agents/run");
  const { opportunityVectorizer } = await import("@/agents/opportunity-vectorizer");

  // Own loop rather than runInference(): that helper drains the PENDING pool,
  // which also holds ~900 never-vectorized rows — this run must touch exactly
  // the rows that carry the old structure, nothing else. Rows re-done get a
  // fresh vectorizedAt and fall out of the selection.
  const cutoff = new Date();
  const stale = () =>
    db
      .select()
      .from(opportunities)
      .where(and(isNotNull(opportunities.vectorizedAt), lt(opportunities.vectorizedAt, cutoff), ne(opportunities.source, "sample")))
      .orderBy(asc(opportunities.vectorizedAt))
      .limit(BATCH);
  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(and(isNotNull(opportunities.vectorizedAt), lt(opportunities.vectorizedAt, cutoff)));
  console.log(`${total} row(s) carry the old extraction structure. Re-vectorizing ${BATCH} at a time…`);

  let done = 0;
  let failed = 0;
  for (;;) {
    if (done + failed >= limit) break;
    const batch = await stale();
    if (!batch.length) break;
    for (const row of batch) {
      if (done + failed >= limit) break;
      try {
        const { output } = await runAgent(opportunityVectorizer, { jd: row.rawText ?? "" }, { userId: "revectorize" });
        // board rows: the ATS's own fields are authoritative (same rule as runInference)
        if (row.source !== "other") {
          output.facts.title = row.title || output.facts.title;
          output.facts.company = row.company || output.facts.company;
          output.facts.location = row.location ?? output.facts.location;
        }
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
        done++;
        console.log(`  + [${done}/${total}] ${row.title}`);
      } catch (e) {
        failed++;
        // stamp it re-done anyway so a poison row can't wedge the loop; old
        // vector/facts stay in place (better stale than empty)
        await db.update(opportunities).set({ vectorizedAt: sql`now()` }).where(eq(opportunities.id, row.id));
        console.log(`  ! ${row.title} — ${(e as Error).message} (kept old extraction)`);
      }
    }
    console.log(`  …cooling down ${COOLDOWN_MS / 1000}s (${done + failed}/${total})`);
    await new Promise((r) => setTimeout(r, COOLDOWN_MS));
  }
  console.log(`Re-vectorization complete: ${done} re-done, ${failed} kept old extraction (of ${total}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
