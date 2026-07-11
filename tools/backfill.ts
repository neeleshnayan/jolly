/**
 * Headless backfill — the SAME runInference the admin ♻ Backfill button calls,
 * for when you want the sweep without a dev server (overnight runs, cron).
 * Replaced tools/revectorize.ts and tools/tiered-revectorize.ts, whose private
 * copies of the pipeline had drifted (cutoff semantics that re-did final rows).
 * All selection logic lives in ONE place: lib/jobs/fetch (pending + old-schema
 * + untrusted-model + old-prompt; converges to zero, skips finished rows).
 *
 *   npx tsx tools/backfill.ts                 # sweep everything that needs it
 *   npx tsx tools/backfill.ts --limit=50      # bounded run
 *   npx tsx tools/backfill.ts --sleep=0       # no cooldown (watch thermals)
 *
 * Don't run while the dev-server sweep is active — the DB evidence guard in the
 * admin route can't see this process (same GPU, double work).
 */
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) { const q = v[0]; const e = v.indexOf(q, 1); v = e > 0 ? v.slice(1, e) : v.slice(1); }
    else { const h = v.indexOf(" #"); if (h >= 0) v = v.slice(0, h).trim(); }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  loadEnvLocal();
  process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  // Two-pass on purpose: gemma3:27b already fills the 23GB card, so embedding
  // inline (nomic) evicts gemma and forces a ~30s reload EVERY row (VRAM
  // sawtooth). Phase 1 extracts with gemma resident the whole time; Phase 2 fills
  // embeddings in one nomic-only pass. Roughly halves the sweep + no thrash.
  process.env.EMBED_INLINE = "0";
  const { runInference } = await import("@/lib/jobs/fetch");
  const result = await runInference({
    limit: Number(arg("limit") ?? 2000),
    batchSize: Number(arg("batch") ?? 5),
    sleepMs: Number(arg("sleep") ?? 5) * 1000,
    force: true,
    tiered: true,
    log: (line) => console.log(line),
  });
  console.log(`\nvectorized ${result.vectorized}, failed ${result.failed}, ${result.remaining} remaining`);

  // Phase 2 — embeddings (nomic only, gemma now idle → no eviction)
  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { and, isNotNull, isNull, eq } = await import("drizzle-orm");
  const { embed, roleEmbedText } = await import("@/lib/embeddings");
  const need = await db
    .select({ id: opportunities.id, title: opportunities.title, facts: opportunities.facts })
    .from(opportunities)
    .where(and(isNotNull(opportunities.vectorizedAt), isNull(opportunities.embedding)));
  console.log(`\nembedding pass: ${need.length} rows (nomic, gemma idle)…`);
  const EB = 32;
  let done = 0;
  for (let i = 0; i < need.length; i += EB) {
    const b = need.slice(i, i + EB);
    try {
      const vecs = await embed(b.map((r) => roleEmbedText((r.facts ?? {}) as Record<string, never>, r.title)));
      await Promise.all(b.map((r, j) => (vecs[j] ? db.update(opportunities).set({ embedding: vecs[j] }).where(eq(opportunities.id, r.id)) : Promise.resolve())));
      done += b.length;
    } catch (e) { console.log(`  embed batch @${i} failed: ${(e as Error).message.slice(0, 50)}`); }
  }
  console.log(`embeddings filled: ${done}/${need.length}`);
  process.exit(result.failed > 0 && result.vectorized === 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
