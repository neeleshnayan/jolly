/**
 * HELD-OUT v5 check. The fixes were tuned on the audit-flagged rows; this
 * re-extracts a DIFFERENT, discipline-diverse slice of the same 107-row batch
 * (audit rows excluded) through the real production path and auto-judges the two
 * failure modes a deterministic cap can introduce:
 *   OVER-fire  — a genuinely technical role wrongly capped (eng title, td now low)
 *   UNDER-fire — a non-technical role still scoring technical (GTM/design/legal high)
 * plus comp-annualization on unseen hourly/period rows. No DB writes.
 *   npx tsx tools/holdout-v5.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
process.env.LLM_PROVIDER_VECTORIZE = "ollama";

// exact titles the audit already flagged / validate-v5 covers — held OUT
const SEEN = /sales strategy|brand designer|growth marketing|commercial counsel|inside sales|gtm engineer|fellows program|medical assistant|new grad|staff software engineer/i;
const ENG = /\b(software|backend|frontend|full.?stack|infrastructure|platform engineer|ML engineer|machine learning|data engineer|security engineer|site reliab|\bSRE\b|systems engineer|research engineer|compiler)\b/i;
const NONTECH = /\b(account executive|account manager|sales|marketing|brand|content|community|recruit|talent|people|customer success|support|designer|counsel|legal|compliance|partnerships)\b/i;
const ADJACENT = /\b(sales engineer|solutions engineer|solutions architect|technical program|developer advocate|forward.?deployed)\b/i;

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, and, ne, isNotNull } = await import("drizzle-orm");
  const { extractRole, applyRowAuthority, STRONG_MODEL } = await import("../src/lib/jobs/vectorize");

  // pull the whole v4 batch, then stratify in JS for a balanced, diverse sample
  const all = (await db
    .select({ title: opportunities.title, company: opportunities.company, location: opportunities.location, source: opportunities.source, rawText: opportunities.rawText })
    .from(opportunities)
    .where(and(sql`(facts->>'prompt_v')::int = 4`, isNotNull(opportunities.rawText), sql`length(raw_text) > 500`, ne(opportunities.source, "sample")))) as {
    title: string | null; company: string | null; location: string | null; source: string | null; rawText: string | null;
  }[];

  const pool = all.filter((r) => !SEEN.test(r.title ?? ""));
  const engRows = pool.filter((r) => ENG.test(r.title ?? "") && !NONTECH.test(r.title ?? ""));
  const gtmRows = pool.filter((r) => NONTECH.test(r.title ?? "") && !ENG.test(r.title ?? "") && !ADJACENT.test(r.title ?? ""));
  const other = pool.filter((r) => !ENG.test(r.title ?? "") && !NONTECH.test(r.title ?? ""));
  // deterministic spread (no RNG): take evenly across each bucket
  const take = <T,>(xs: T[], n: number) => xs.filter((_, i) => i % Math.max(1, Math.floor(xs.length / n)) === 0).slice(0, n);
  const sample = [...take(engRows, 6), ...take(gtmRows, 6), ...take(other, 4)];

  console.log(`HELD-OUT v5 — ${sample.length} unseen rows (${engRows.length} eng / ${gtmRows.length} gtm / ${other.length} other in batch)\n${"=".repeat(78)}`);
  let over = 0, under = 0, ok = 0;
  for (const r of sample) {
    try {
      const out = await extractRole(r.rawText ?? "", STRONG_MODEL);
      applyRowAuthority(out, { title: r.title, company: r.company, location: r.location, source: r.source });
      const td = out.vector.req_technical_depth?.score ?? -1;
      const capped = /capped/.test(out.vector.req_technical_depth?.rationale ?? "");
      const title = r.title ?? "";
      const isEng = ENG.test(title) && !NONTECH.test(title);
      const isGtm = NONTECH.test(title) && !ENG.test(title) && !ADJACENT.test(title);
      let verdict = "  ";
      if (isEng && (td < 0.6 || capped)) { verdict = "🔴OVER"; over++; }
      else if (isGtm && td > 0.45) { verdict = "🟠UNDER"; under++; }
      else ok++;
      console.log(`  ${verdict}  td=${td}${capped ? " (capped)" : "       "}  ${(title).slice(0, 42).padEnd(42)} @ ${(r.company ?? "?").slice(0, 12)}`);
    } catch (e) { console.log(`  !  ${(r.title ?? "?").slice(0, 42)} — ${(e as Error).message.slice(0, 40)}`); }
  }
  console.log(`\n${"=".repeat(78)}\n${over === 0 && under === 0 ? "✅" : "⚠"}  ${ok} clean · ${over} OVER-fire (eng wrongly capped) · ${under} UNDER-fire (gtm still technical)`);
  console.log("read the 🟠/🔴 rows — a Sales Engineer scoring 0.6 is CORRECT, not under-fire; judge by the actual work.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
