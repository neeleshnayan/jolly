/**
 * Phase-0 anchor selector. Pulls a diverse TOUGH+SIMPLE spread of real crunched
 * rows and freezes each one's {facts, vector, embedding} into a fixture file, so
 * the regression harness (tools/anchors.ts) can assert ranking-LOGIC behavior
 * against FIXED inputs — independent of whatever the live DB holds, and therefore
 * stable across the eventual clean-slate re-crunch.
 *
 *   npx tsx tools/pick-anchors.ts        # writes tools/fixtures/anchors.json + prints a table
 *
 * Prefer v4 rows where they exist (that's the post-crunch world); everything else
 * is representative-enough for a logic test. Re-run to refresh after a re-crunch.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}

// each pick: a label (why it's here) + a title matcher; we take the best single
// row (has embedding, richest JD, trusted model) that matches.
const PICKS: { key: string; why: string; like: string; prefer?: string }[] = [
  // ---- SIMPLE: obvious matches that must NEVER break ----
  { key: "backend_ic", why: "clear senior backend/infra IC → top for senior-IC", like: "backend|infrastructure engineer|platform engineer|distributed" },
  { key: "eng_manager", why: "clear people-manager → top for EM", like: "engineering manager|manager, engineering" },
  { key: "sales_ae", why: "clear enterprise AE → top for sales", like: "account executive" },
  { key: "marketing", why: "clear marketing/content → top for marketer", like: "marketing manager|content|brand" },
  { key: "data_analyst", why: "clear junior-ish analyst → clears for junior analyst", like: "data analyst" },
  // ---- TOUGH: discipline / seniority / gate / creds stress ----
  { key: "newgrad_swe", why: "new-grad SWE: sales MUST gate low; analyst mid", like: "new grad", prefer: "software|engineer" },
  { key: "staff_ic", why: "staff/principal IC: junior MUST gate low on seniority", like: "staff software|principal engineer|staff engineer" },
  { key: "director", why: "director/VP: junior MUST gate low; EM ok", like: "director|head of|vp " },
  { key: "media_social", why: "Vercel 'Media Engineer, Social' = CONTENT not eng", like: "media engineer" },
  { key: "specialist", why: "deep specialist (compiler/security/research) → breadth stress", like: "compiler|security engineer|research engineer|cryptograph" },
  { key: "creds_role", why: "role with a hard credential (JD/CPA/PhD/bar) → hardGate", like: "counsel|attorney|accountant|clinical|physician" },
  { key: "solutions_eng", why: "technical-adjacent (solutions/sales eng) → tech_depth mid", like: "solutions engineer|sales engineer|forward deployed" },
  { key: "partner_dev", why: "partnerships/bizdev → GTM-adjacent", like: "partner development|business development|partnerships" },
  { key: "early_startup", why: "early-stage/high-risk → risk & growth desire stress", like: "founding|first " },
  { key: "product_manager", why: "PM: career-changer target; tech-adjacent", like: "product manager" },
  { key: "recruiter_ops", why: "recruiting/people-ops → red flag for eng profiles", like: "recruiter|people partner|talent" },
];

const ax = ["req_seniority", "req_leadership", "req_technical_depth", "req_breadth", "off_growth", "off_company_risk", "off_impact", "off_domain_novelty"] as const;
const sc = (v: Record<string, { score?: number }>, k: string) => (v?.[k]?.score ?? null);

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { and, eq, isNotNull, ne, sql, desc } = await import("drizzle-orm");
  const { STRONG_MODEL } = await import("../src/lib/jobs/vectorize");

  const chosen: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const pick of PICKS) {
    // best match: trusted model + has embedding + richest JD; prefer v4 & the
    // secondary token when given (e.g. "new grad" AND software)
    const rows = await db
      .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, facts: opportunities.facts, vector: opportunities.vector, embedding: opportunities.embedding })
      .from(opportunities)
      .where(and(
        eq(opportunities.vectorizeModel, STRONG_MODEL),
        isNotNull(opportunities.embedding),
        ne(opportunities.source, "sample"),
        sql`lower(title) ~ ${pick.like}`,
        ...(pick.prefer ? [sql`lower(title) ~ ${pick.prefer}`] : []),
      ))
      .orderBy(desc(sql`(facts->>'prompt_v')::int`), desc(sql`length(raw_text)`))
      .limit(4);
    const row = rows.find((r) => !seen.has(r.id));
    if (!row) { console.log(`  ⚠ no row for ${pick.key} (${pick.like})`); continue; }
    seen.add(row.id);
    const f = (row.facts ?? {}) as Record<string, unknown>;
    const v = (row.vector ?? {}) as Record<string, { score?: number }>;
    chosen.push({
      key: pick.key, why: pick.why,
      id: row.id, title: row.title, company: row.company,
      facts: f, vector: v, embedding: row.embedding,
    });
  }

  mkdirSync("tools/fixtures", { recursive: true });
  writeFileSync("tools/fixtures/anchors.json", JSON.stringify(chosen, null, 0));

  // compact table for authoring — vector axes + facts that drive gating
  console.log(`\nfroze ${chosen.length} anchor rows → tools/fixtures/anchors.json\n`);
  console.log(`key            sen lead tech brd | grw rsk imp nov | v yrs creds        title`);
  for (const c of chosen as never[]) {
    const v = (c as { vector: Record<string, { score?: number }> }).vector;
    const f = (c as { facts: Record<string, unknown> }).facts;
    const n = (x: number | null) => (x === null ? " · " : x.toFixed(1).padStart(3));
    const pv = String(f.prompt_v ?? "?");
    const yrs = f.min_years_experience == null ? "·" : String(f.min_years_experience);
    const creds = ((f.required_credentials as string[]) ?? []).join(",") || "—";
    const skills = ((f.must_have_skills as string[]) ?? []).slice(0, 3).join("/");
    console.log(
      `${(c as { key: string }).key.padEnd(14)} ${n(sc(v, ax[0]))} ${n(sc(v, ax[1]))} ${n(sc(v, ax[2]))} ${n(sc(v, ax[3]))} |` +
      ` ${n(sc(v, ax[4]))} ${n(sc(v, ax[5]))} ${n(sc(v, ax[6]))} ${n(sc(v, ax[7]))} |` +
      ` ${pv} ${yrs.padStart(3)} ${creds.padEnd(12)} ${(c as { title: string }).title?.slice(0, 40)}  ·${skills}`
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
