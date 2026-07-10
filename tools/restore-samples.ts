/**
 * Re-apply the curated facts+vector onto the sample-source opportunities.
 * The demo samples have hand-authored extraction (sampleExtraction) over very
 * short JDs — a model re-vectorise would clobber them with sparse output, so
 * the backfill (lib/jobs/fetch + tools/backfill.ts) excludes source='sample'.
 * Run this if any got overwritten.
 *   npx tsx tools/restore-samples.ts
 * Idempotent: sets each sample row back to its canonical curated facts.
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

async function main() {
  loadEnvLocal();
  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { SAMPLE_JOBS, sampleExtraction } = await import("@/lib/opportunities/samples");
  let n = 0;
  for (const j of SAMPLE_JOBS) {
    const ext = sampleExtraction(j);
    const res = await db
      .update(opportunities)
      .set({ facts: ext.facts, vector: ext.vector })
      .where(and(eq(opportunities.source, "sample"), eq(opportunities.title, j.title)))
      .returning({ id: opportunities.id });
    if (res.length) { n += res.length; console.log("restored:", j.title, `(${res.length})`); }
  }
  console.log(`done — ${n} sample row(s) restored`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
