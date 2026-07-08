/**
 * Smoke test the FINAL extraction structure on real pulled JDs before the big
 * re-vectorization. No DB writes — prints the new fields for eyeballing.
 * Picks adversarial cases: PhD required vs preferred, years bars, licenses.
 *   npx tsx tools/smoke-extraction.ts
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

async function main() {
  loadEnvLocal();
  process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const { runAgent } = await import("@/agents/run");
  const { opportunityVectorizer } = await import("@/agents/opportunity-vectorizer");

  // adversarial picks from the real pool
  const cases: { label: string; where: ReturnType<typeof sql> }[] = [
    { label: "PhD required", where: sql`raw_text ~* 'ph\\.?d' and raw_text ~* '(ph\\.?d[^.]{0,50}required|required[^.]{0,50}ph\\.?d)'` },
    { label: "PhD preferred only", where: sql`raw_text ~* 'ph\\.?d[^.]{0,40}(preferred|a plus|or equivalent)' and raw_text !~* 'ph\\.?d[^.]{0,40}required'` },
    { label: "explicit years bar", where: sql`raw_text ~* '(8|10|12)\\+\\s*years'` },
    { label: "legal role", where: sql`title ~* 'counsel|attorney|legal'` },
    { label: "plain (no stated bars)", where: sql`raw_text !~* 'ph\\.?d|\\d+\\+\\s*years' and length(raw_text) > 500` },
  ];

  for (const c of cases) {
    const [row] = await db
      .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, location: opportunities.location, rawText: opportunities.rawText })
      .from(opportunities)
      .where(c.where)
      .limit(1);
    if (!row) {
      console.log(`\n### ${c.label}: no matching row in pool`);
      continue;
    }
    console.log(`\n### ${c.label}: ${row.title} @ ${row.company} [${row.location}]`);
    try {
      const { output } = await runAgent(opportunityVectorizer, { jd: row.rawText ?? "" }, { userId: "smoke-test" });
      const f = output.facts;
      console.log(`    min_years_experience: ${f.min_years_experience}`);
      console.log(`    required_credentials: ${JSON.stringify(f.required_credentials)}`);
      console.log(`    comp: ${f.comp_min}–${f.comp_max} ${f.comp_currency}`);
      console.log(`    domain: ${f.domain} · remote: ${f.remote}`);
      // show the JD's own words about the credential, for eyeball comparison
      const evidence = (row.rawText ?? "").match(/[^.]{0,80}(ph\.?d|\d+\+\s*years|bar admission|law degree|j\.?d\.?)[^.]{0,80}/gi);
      if (evidence) console.log(`    JD says: ${evidence.slice(0, 3).map((e) => `"…${e.trim()}…"`).join("  |  ")}`);
    } catch (e) {
      console.log(`    ! extraction failed: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
