/**
 * Pre-flight for a prompt change: run the CURRENT extraction on N random,
 * SOURCE-DIVERSE JDs (no DB writes) and show the per-axis spread. The backfill
 * processes oldest-first (single-vertical batches), so this is the only honest
 * way to see whether rubric anchors differentiate across verticals BEFORE
 * committing the GPU to a full sweep.
 *   npx tsx tools/validate-prompt.ts --n=10
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
loadEnvLocal();
process.env.LLM_PROVIDER_VECTORIZE = "ollama";
const N = Number(process.argv.find((a) => a.startsWith("--n="))?.split("=")[1] ?? 10);

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, and, isNotNull, ne } = await import("drizzle-orm");
  const { extractRole, STRONG_MODEL } = await import("../src/lib/jobs/vectorize");

  // diverse: random across the pool, long-enough JDs, all sources
  const rows = await db
    .select({ title: opportunities.title, company: opportunities.company, rawText: opportunities.rawText })
    .from(opportunities)
    .where(and(isNotNull(opportunities.rawText), sql`length(${opportunities.rawText}) >= 800`, ne(opportunities.source, "sample")))
    .orderBy(sql`random()`)
    .limit(N);

  console.log(`Validating prompt on ${rows.length} random JDs (${STRONG_MODEL}, no DB writes)\n`);
  const axisVals = new Map<string, number[]>();
  const rowSpreads: number[] = [];
  for (const [i, r] of rows.entries()) {
    const t0 = Date.now();
    try {
      const out = await extractRole(r.rawText ?? "", STRONG_MODEL);
      const entries = Object.entries(out.vector as Record<string, { score?: number }>)
        .map(([k, v]) => [k, v?.score] as const)
        .filter((x): x is readonly [string, number] => typeof x[1] === "number");
      const vals = entries.map(([, s]) => s);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      rowSpreads.push(Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length));
      for (const [k, s] of entries) {
        if (!axisVals.has(k)) axisVals.set(k, []);
        axisVals.get(k)!.push(s);
      }
      console.log(`  [${i + 1}/${rows.length}] ${((Date.now() - t0) / 1000).toFixed(0)}s  ${r.title} @ ${r.company} — growth ${entries.find(([k]) => k === "off_growth")?.[1]?.toFixed(2)}, breadth ${entries.find(([k]) => k === "req_breadth")?.[1]?.toFixed(2)}, impact ${entries.find(([k]) => k === "off_impact")?.[1]?.toFixed(2)}`);
    } catch (e) {
      console.log(`  [${i + 1}/${rows.length}] ERROR ${r.title} — ${(e as Error).message.slice(0, 60)}`);
    }
  }
  console.log(`\nper-axis across ${rows.length} DIVERSE roles (std < 0.06 = still lazy):`);
  for (const [k, a] of [...axisVals.entries()].sort()) {
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    const std = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
    console.log(`  ${k.padEnd(24)} ${mean.toFixed(2)} ± ${std.toFixed(3)}${std < 0.06 ? "  ← LAZY" : ""}`);
  }
  const ms = rowSpreads.reduce((a, b) => a + b, 0) / (rowSpreads.length || 1);
  console.log(`mean per-row spread: ${ms.toFixed(3)} (healthy ≳ 0.18)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
