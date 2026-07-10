/**
 * NON-TECH end-to-end check. Pulls NEVER-VECTORIZED rows (real ingested JDs the
 * model has never processed) in the disciplines the tech_depth guard exists for
 * — marketing, legal, operations, finance/HR, sales — and runs each through the
 * full v5 extraction path (extractRole → applyRowAuthority → reconcileTechDepth).
 * Every one SHOULD land low on req_technical_depth; anything technical is either
 * a genuinely technical-adjacent role (engineer/analyst in the title → fine) or a
 * guard miss to read. No DB writes.  npx tsx tools/holdout-nontech.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
process.env.LLM_PROVIDER_VECTORIZE = "ollama";

const BUCKETS: [string, RegExp][] = [
  ["marketing", /\b(marketing|brand|content|communications|growth marketing|demand gen|social|SEO|campaign|copywrit)\b/i],
  ["legal", /\b(legal|counsel|attorney|paralegal|compliance|privacy|contracts|regulatory)\b/i],
  ["operations", /\b(operations|ops|program manager|project manager|procurement|logistics|supply|workplace|facilities|chief of staff)\b/i],
  ["finance/hr", /\b(finance|financial|accounting|accountant|controller|payroll|people|human resources|\bHR\b|recruit|talent|benefits)\b/i],
  ["sales/cs", /\b(account executive|account manager|sales(?! engineer)|business development|customer success(?! engineer)|partnerships|revenue|support special)\b/i],
];
// title carries a genuine technical discipline → allowed to score mid/high
const TECHy = /\b(engineer|developer|software|scientist|\bML\b|data engineer|analyst|architect|quant|security engineer)\b/i;

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, and, ne, isNotNull, isNull } = await import("drizzle-orm");
  const { extractRole, applyRowAuthority, STRONG_MODEL } = await import("../src/lib/jobs/vectorize");

  const pending = (await db
    .select({ title: opportunities.title, company: opportunities.company, location: opportunities.location, source: opportunities.source, rawText: opportunities.rawText })
    .from(opportunities)
    .where(and(isNull(opportunities.vectorizedAt), isNotNull(opportunities.rawText), sql`length(raw_text) > 500`, ne(opportunities.source, "sample")))) as {
    title: string | null; company: string | null; location: string | null; source: string | null; rawText: string | null;
  }[];

  // 3-4 per discipline, spread across distinct companies
  const sample: { r: (typeof pending)[0]; bucket: string }[] = [];
  for (const [name, re] of BUCKETS) {
    const hits = pending.filter((r) => re.test(r.title ?? "") && !sample.some((s) => s.r === r));
    const seenCo = new Set<string>();
    for (const r of hits) {
      const co = r.company ?? "?";
      if (seenCo.has(co)) continue;
      seenCo.add(co); sample.push({ r, bucket: name });
      if (seenCo.size >= 4) break;
    }
  }

  console.log(`NON-TECH end-to-end (v5, ${STRONG_MODEL}) — ${sample.length} never-vectorized rows\n${"=".repeat(80)}`);
  let low = 0, adjacent = 0, miss = 0;
  for (const { r, bucket } of sample) {
    try {
      const out = await extractRole(r.rawText ?? "", STRONG_MODEL);
      applyRowAuthority(out, { title: r.title, company: r.company, location: r.location, source: r.source });
      const td = out.vector.req_technical_depth?.score ?? -1;
      const capped = /capped/.test(out.vector.req_technical_depth?.rationale ?? "");
      const techy = TECHy.test(r.title ?? "");
      let mark = "✅";
      if (td <= 0.4) low++;
      else if (techy && td <= 0.65) { adjacent++; mark = "· "; } // analyst/engineer-in-title → adjacent OK
      else { miss++; mark = "🔴"; }
      const comp = out.facts.comp_max != null ? `${out.facts.comp_min ?? "∅"}-${out.facts.comp_max} ${out.facts.comp_currency ?? ""}` : "no comp";
      console.log(`  ${mark} [${bucket.padEnd(10)}] td=${td}${capped ? "c" : " "} ${comp.padEnd(20)} ${(r.title ?? "?").slice(0, 40)} @ ${(r.company ?? "?").slice(0, 12)}`);
    } catch (e) { console.log(`  !  [${bucket}] ${(r.title ?? "?").slice(0, 40)} — ${(e as Error).message.slice(0, 36)}`); }
  }
  console.log(`\n${"=".repeat(80)}\n${miss === 0 ? "✅" : "⚠"}  ${low} clearly-low · ${adjacent} adjacent (analyst/eng in title) · ${miss} 🔴 miss (non-tech scoring technical)`);
  console.log("🔴 = read it: a role with no engineer/analyst in the title scoring >0.4 is a guard gap.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
