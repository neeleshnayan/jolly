/**
 * FAILURE HUNT over the current-prompt (v4) batch. Read-only. Scans every v4 row
 * for logic failures a human would catch instantly:
 *   1. title ↔ vector contradictions (eng title w/ low tech_depth, GTM title w/
 *      high; intern/new-grad w/ high seniority; director+ w/ low; IC w/ high
 *      leadership req)
 *   2. facts nonsense — comp min>max, comp w/o currency, suspicious tiny/huge
 *      comp for the currency, country missing on a located role
 *   3. dead rows — within-row vector flatness (describing, not judging)
 *   4. coverage — missing summary/skills/core_requirements, self-flags
 * Prints per-check hits with row detail so fixes target real failures.
 *   npx tsx tools/v4-audit.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, and, ne, eq } = await import("drizzle-orm");
  const { STRONG_MODEL } = await import("../src/lib/jobs/vectorize");
  const { VECTORIZE_PROMPT_VERSION } = await import("../src/agents/opportunity-vectorizer");

  const rows = (await db
    .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, location: opportunities.location, compMin: opportunities.compMin, compMax: opportunities.compMax, vector: opportunities.vector, facts: opportunities.facts })
    .from(opportunities)
    .where(and(eq(opportunities.vectorizeModel, STRONG_MODEL), ne(opportunities.source, "sample"), sql`(facts->>'prompt_v')::int = ${VECTORIZE_PROMPT_VERSION}`))) as {
    id: string; title: string | null; company: string | null; location: string | null; compMin: number | null; compMax: number | null;
    vector: Record<string, { score?: number }> | null; facts: Record<string, unknown> | null;
  }[];

  console.log(`v4 FAILURE HUNT — ${rows.length} rows on prompt v${VECTORIZE_PROMPT_VERSION}\n${"=".repeat(74)}`);
  const s = (r: (typeof rows)[0], k: string) => r.vector?.[k]?.score;
  const hits: Record<string, string[]> = {};
  const flag = (check: string, msg: string) => (hits[check] ??= []).push(msg);
  const t = (r: (typeof rows)[0]) => `${(r.title ?? "?").slice(0, 46)} @ ${(r.company ?? "?").slice(0, 14)}`;

  // discipline heuristics on TITLE (deliberately conservative — only flag clear cases)
  const ENG = /\b(software|backend|frontend|full.?stack|infrastructure|platform|ML|machine learning|data engineer|security engineer|site reliab|SRE|systems engineer|research engineer|quant)\b/i;
  const GTM = /\b(account executive|sales(?! engineer)|account manager|business development|marketing|brand|content(?! engineer)|community manager|recruit|talent|people ops|customer success(?! engineer)|support special|copywrit)\b/i;
  const JUNIOR = /\b(intern|new grad|entry|junior|associate(?! general counsel| director))\b/i;
  const SENIOR_TITLE = /\b(director|VP|vice president|head of|chief|principal|staff|distinguished)\b/i;
  const MGR = /\b(manager of|engineering manager|manager,|team lead|head of)\b/i;

  for (const r of rows) {
    const title = r.title ?? "";
    const td = s(r, "req_technical_depth"), sen = s(r, "req_seniority"), lead = s(r, "req_leadership");
    const f = (r.facts ?? {}) as { comp_currency?: string; country?: string; summary?: string; must_have_skills?: string[]; core_requirements?: string[]; needs_review?: boolean; review_reason?: string; min_years_experience?: number | null };

    // 1 — title↔vector contradictions
    if (ENG.test(title) && !/manager|director|head/i.test(title) && td !== undefined && td < 0.6) flag("eng title, LOW tech_depth", `${t(r)} → td=${td}`);
    if (GTM.test(title) && !ENG.test(title) && td !== undefined && td > 0.55) flag("GTM title, HIGH tech_depth", `${t(r)} → td=${td}`);
    if (JUNIOR.test(title) && sen !== undefined && sen > 0.5) flag("junior title, HIGH seniority", `${t(r)} → sen=${sen}`);
    if (SENIOR_TITLE.test(title) && sen !== undefined && sen < 0.5) flag("senior title, LOW seniority", `${t(r)} → sen=${sen}`);
    if (!MGR.test(title) && /engineer|scientist|analyst|designer|counsel|accountant/i.test(title) && lead !== undefined && lead > 0.6) flag("IC title, HIGH req_leadership", `${t(r)} → lead=${lead}`);

    // 2 — facts nonsense
    if (r.compMin != null && r.compMax != null && r.compMin > r.compMax) flag("comp min > max", `${t(r)} → ${r.compMin}–${r.compMax}`);
    if ((r.compMin != null || r.compMax != null) && !f.comp_currency) flag("comp without currency", `${t(r)} → ${r.compMin}–${r.compMax}`);
    if (f.comp_currency === "USD" && r.compMax != null && (r.compMax < 20000 || r.compMax > 2000000)) flag("USD comp out of range", `${t(r)} → ${r.compMin}–${r.compMax} USD`);
    if (f.comp_currency === "INR" && r.compMax != null && r.compMax < 100000) flag("INR comp suspiciously small", `${t(r)} → ${r.compMin}–${r.compMax} INR (lakhs not expanded?)`);
    if (r.location && r.location.trim() && !/remote/i.test(r.location) && !f.country) flag("located role, NO country", `${t(r)} → loc="${r.location?.slice(0, 30)}"`);
    if (f.min_years_experience != null && (f.min_years_experience as number) > 25) flag("absurd min_years", `${t(r)} → ${f.min_years_experience} yrs`);

    // 3 — flat vector (all 12 axes within a ±0.1 band = described, not judged)
    const scores = Object.values(r.vector ?? {}).map((p) => p?.score).filter((x): x is number => typeof x === "number");
    if (scores.length >= 10) {
      const mn = Math.min(...scores), mx = Math.max(...scores);
      if (mx - mn <= 0.25) flag("FLAT vector (spread ≤0.25)", `${t(r)} → [${mn}..${mx}]`);
    }

    // 4 — coverage
    if (!f.summary?.trim()) flag("missing summary", t(r));
    if (!f.must_have_skills?.length) flag("no must_have_skills", t(r));
    if (f.needs_review === true) flag("self-flagged needs_review", `${t(r)} → "${f.review_reason ?? "?"}"`);
  }

  const checks = Object.keys(hits).sort((a, b) => hits[b].length - hits[a].length);
  if (!checks.length) { console.log("\n✅ zero hits across all checks."); process.exit(0); }
  for (const c of checks) {
    console.log(`\n■ ${c} — ${hits[c].length} hit(s)`);
    for (const h of hits[c].slice(0, 8)) console.log(`   ${h}`);
    if (hits[c].length > 8) console.log(`   … +${hits[c].length - 8} more`);
  }
  const flagged = new Set(Object.values(hits).flat()).size;
  console.log(`\n${"=".repeat(74)}\n${flagged} flags over ${rows.length} rows — read each hit; heuristics are conservative but not infallible (a "Sales Engineer" is genuinely technical).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
