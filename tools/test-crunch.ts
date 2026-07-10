/**
 * 100-row v4 TEST-BATCH crunch. Selects a company-stratified spread (≤3 per
 * company for cross-vertical diversity) of rows NOT yet on prompt v4, and
 * re-vectorizes them to v4 with inline embeddings — the same writeVectorization
 * the full sweep uses. This is the "are we happy on FRESH crunches" gate before
 * the clean-slate wipe+recrunch. Idempotent: re-running skips rows already v4, so
 * it converges. Progress prints per row.
 *
 *   npx tsx tools/test-crunch.ts            # default 100
 *   npx tsx tools/test-crunch.ts --n=50
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
process.env.LLM_PROVIDER_VECTORIZE = "ollama";
const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const N = arg("n", 100);
const BATCH = arg("batch", 0); // 0 = no cooldown; else pause after every BATCH rows
const COOLDOWN = arg("cooldown", 0); // seconds of GPU/thermal rest between batches
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql } = await import("drizzle-orm");
  const { extractRole, applyRowAuthority, writeVectorization, STRONG_MODEL } = await import("../src/lib/jobs/vectorize");
  const { VECTORIZE_PROMPT_VERSION } = await import("../src/agents/opportunity-vectorizer");

  // company-stratified: ≤3 rows per company, only rows not already at the current
  // prompt version, richest JD first within each company. Cross-vertical by design.
  const rows = await db.execute(sql`
    select id, title, company, location, raw_text, source from (
      select o.id, o.title, o.company, o.location, o.raw_text, o.source,
             row_number() over (partition by o.company order by length(o.raw_text) desc) as rn
      from opportunities o
      where o.source <> 'sample'
        and length(o.raw_text) > 400
        and coalesce((o.facts->>'prompt_v')::int, 0) < ${VECTORIZE_PROMPT_VERSION}
    ) q
    where q.rn <= 3
    order by q.rn, q.company
    limit ${N}
  `) as unknown as { id: string; title: string; company: string; location: string; raw_text: string; source: string }[];

  console.log(`test-crunch: ${rows.length} rows → v${VECTORIZE_PROMPT_VERSION} (${STRONG_MODEL}) + embeddings${BATCH ? ` · ${COOLDOWN}s cooldown / ${BATCH} rows` : ""}\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const out = await extractRole(r.raw_text ?? "", STRONG_MODEL);
      applyRowAuthority(out, { title: r.title, company: r.company, location: r.location, source: r.source });
      await writeVectorization(r.id, out, STRONG_MODEL, { title: r.title, company: r.company, location: r.location, source: r.source });
      ok++;
      console.log(`  [${i + 1}/${rows.length}] ✓ ${(r.company ?? "?").slice(0, 16).padEnd(16)} ${(r.title ?? "?").slice(0, 42)}`);
    } catch (e) {
      fail++;
      console.log(`  [${i + 1}/${rows.length}] ✗ ${(r.title ?? "?").slice(0, 42)} — ${(e as Error).message.slice(0, 50)}`);
    }
    // GPU/thermal breather between batches (skip after the final row)
    if (BATCH && COOLDOWN && (i + 1) % BATCH === 0 && i < rows.length - 1) {
      console.log(`  — cooldown ${COOLDOWN}s —`);
      await sleep(COOLDOWN);
    }
  }
  console.log(`\ndone: ${ok} ok, ${fail} failed. Now run: npx tsx tools/anchors.ts && npx tsx tools/match-sanity.ts`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
