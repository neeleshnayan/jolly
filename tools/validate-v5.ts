/**
 * Pre-lock check for prompt v5 against the EXACT rows the v4 audit flagged
 * (tools/v4-audit.ts) + engineering controls that must NOT regress. No DB
 * writes.  npx tsx tools/validate-v5.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
process.env.LLM_PROVIDER_VECTORIZE = "ollama";

// [title pattern, company pattern, check, expectation label]
const CASES: [string, string, "td-low" | "td-mid" | "td-high" | "comp-annual", string][] = [
  // v4 failures — tech_depth must come DOWN
  ["%sales strategy & planning%", "airtable", "td-low", "≤0.35 (was 0.8)"],
  ["%brand designer%", "gocardless", "td-low", "≤0.35 (was 0.7)"],
  ["%growth marketing%", "calendly", "td-low", "≤0.35 (was 0.6)"],
  ["%commercial counsel%", "asana", "td-low", "≤0.35 (was 0.6)"],
  ["%account manager (inside sales)%", "point", "td-low", "≤0.35 (was 0.6)"],
  ["%gtm engineer%", "webflow", "td-mid", "0.4–0.6 (was 0.85)"],
  // v4 failures — comp must be ANNUAL
  ["%fellows program%", "anthropic", "comp-annual", "≥50k or null (was 3850)"],
  ["%certified medical assistant%", "onemedical", "comp-annual", "≥30k or null (was 24–26)"],
  // controls — the v4 eng fix must SURVIVE
  ["%software engineer, new grad%", "%", "td-high", "≥0.7 (v4 fix)"],
  ["%staff software engineer%", "%", "td-high", "≥0.7 (v4 fix)"],
];

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, and, ne, isNotNull } = await import("drizzle-orm");
  const { extractRole, applyRowAuthority, STRONG_MODEL } = await import("../src/lib/jobs/vectorize");

  console.log(`v5 validation (${STRONG_MODEL}) — audit rows + controls:\n`);
  let pass = 0, fail = 0;
  for (const [tp, cp, check, want] of CASES) {
    const [r] = await db
      .select({ title: opportunities.title, company: opportunities.company, location: opportunities.location, source: opportunities.source, rawText: opportunities.rawText })
      .from(opportunities)
      .where(and(sql`lower(title) like ${tp}`, sql`lower(company) like ${cp.toLowerCase()}`, isNotNull(opportunities.rawText), sql`length(raw_text) > 400`, ne(opportunities.source, "sample")))
      .limit(1);
    if (!r) { console.log(`  ? no row for "${tp}" @ ${cp}`); continue; }
    try {
      const out = await extractRole(r.rawText ?? "", STRONG_MODEL);
      applyRowAuthority(out, { title: r.title, company: r.company, location: r.location, source: r.source }); // the production path — ATS title is authoritative
      const td = out.vector.req_technical_depth?.score ?? -1;
      const cmax = out.facts.comp_max ?? null;
      let ok: boolean, got: string;
      if (check === "td-low") { ok = td <= 0.35; got = `td=${td}`; }
      else if (check === "td-mid") { ok = td >= 0.35 && td <= 0.65; got = `td=${td}`; }
      else if (check === "td-high") { ok = td >= 0.7; got = `td=${td}`; }
      else { ok = cmax === null || cmax >= 30000; got = `comp=${out.facts.comp_min ?? "∅"}–${cmax ?? "∅"} ${out.facts.comp_currency ?? ""}`; }
      ok ? pass++ : fail++;
      console.log(`  ${ok ? "✅" : "❌"} ${got.padEnd(30)} want ${want}  — ${(r.title ?? "?").slice(0, 44)}`);
    } catch (e) { console.log(`  ! ${(r.title ?? "?").slice(0, 40)} — ${(e as Error).message.slice(0, 50)}`); fail++; }
  }
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
