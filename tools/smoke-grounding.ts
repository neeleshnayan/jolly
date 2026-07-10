/**
 * THE hard extraction-grounding smoke test (version-agnostic): every claim the
 * model made is checked against the raw JD — comp numbers must exist in the
 * text, years must exist, remote must be consistent, skills must not be
 * hallucinated, the summary must be synthesis (not a verbatim JD slice), and
 * the vector must both spread AND agree with what the title says about the
 * role. Ends with two full spot-read dumps for human eyes.
 *   npx tsx tools/smoke-grounding.ts --n=10
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
const N = Number(process.argv.find((a) => a.startsWith("--n="))?.split("=")[1] ?? 10);

type Facts = {
  remote?: string; comp_min?: number | null; comp_max?: number | null; comp_currency?: string | null;
  min_years_experience?: number | null; must_have_skills?: string[]; nice_to_have_skills?: string[];
  summary?: string; country?: string; needs_review?: boolean; review_reason?: string;
};
type Param = { score?: number };
type Vec = Record<string, Param>;

const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ");
// a number "350000" appears in JDs as 350,000 / 350k / 3,50,000 / $350K
function numInText(n: number, text: string): boolean {
  const t = text.replace(/[,\s]/g, "");
  const forms = [String(n), `${Math.round(n / 1000)}k`, `${(n / 1000).toFixed(1)}k`.replace(".0k", "k"), `${Math.round(n / 100000)}l`, `${(n / 1_000_000).toFixed(1)}m`.replace(".0m", "m")];
  return forms.some((f) => t.toLowerCase().includes(f.toLowerCase()));
}
// fuzzy "skill appears in JD": all content words appear — where a word may
// appear as its common abbreviation ("Machine Learning" grounded by "ML")
const ABBREV: Record<string, string[]> = {
  "machine": ["ml"], "learning": ["ml"],
  "artificial": ["ai"], "intelligence": ["ai"],
  "analysis": ["analyz", "analys"], "analytics": ["analyz", "analys"],
  "kubernetes": ["k8s"], "javascript": ["js"], "typescript": ["ts"],
  "management": ["manage", "managing"], "communication": ["communicat"],
  "troubleshooting": ["troubleshoot", "debug"], "debugging": ["debug"],
};
function skillInText(skill: string, text: string): boolean {
  const t = norm(text);
  const words = norm(skill).replace(/[^a-z0-9+#./ -]/g, "").split(/[\s/-]+/).filter((w) => w.length > 2);
  if (!words.length) return t.includes(norm(skill));
  return words.every((w) => t.includes(w) || (ABBREV[w] ?? []).some((a) => new RegExp(`\\b${a}`, "i").test(text)));
}

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { sql, and, ne, eq, desc } = await import("drizzle-orm");
  const rows = await db
    .select({ title: opportunities.title, company: opportunities.company, location: opportunities.location, remote: opportunities.remote, facts: opportunities.facts, vector: opportunities.vector, rawText: opportunities.rawText, at: opportunities.vectorizedAt })
    .from(opportunities)
    .where(and(eq(opportunities.vectorizeModel, "gemma3:27b"), sql`coalesce((${opportunities.facts} ->> 'prompt_v')::int, 1) = 3`, ne(opportunities.source, "sample")))
    .orderBy(desc(opportunities.vectorizedAt))
    .limit(N);

  console.log(`SMOKE TEST — ${rows.length} freshest vectorized rows, every claim vs source text\n${"=".repeat(74)}`);
  let flagged = 0;
  const tally = { checks: 0, fails: 0 };
  const check = (title: string, name: string, ok: boolean | null, detail = "") => {
    if (ok === null) return; // not applicable
    tally.checks++;
    if (!ok) { tally.fails++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}  [${title.slice(0, 44)}]`); }
  };

  for (const r of rows) {
    const f = (r.facts ?? {}) as Facts;
    const v = (r.vector ?? {}) as Vec;
    const text = r.rawText ?? "";
    const title = r.title ?? "?";
    if (f.needs_review) { flagged++; console.log(`  ⚑ self-flagged: ${f.review_reason} [${title.slice(0, 44)}]`); }

    // ---- facts vs source ----
    check(title, "comp_min grounded in JD", f.comp_min ? numInText(f.comp_min, text) : null, String(f.comp_min));
    check(title, "comp_max grounded in JD", f.comp_max ? numInText(f.comp_max, text) : null, String(f.comp_max));
    check(title, "YoE grounded in JD", f.min_years_experience ? new RegExp(`${f.min_years_experience}\\s*\\+?\\s*(year|yr)`, "i").test(text) : null, `${f.min_years_experience}+`);
    const rem = f.remote ?? "unknown";
    check(title, "remote value consistent", rem === "unknown" ? null : rem === "remote" ? /remote/i.test(text) : rem === "hybrid" ? /hybrid|days? (in|per) (the )?office|in[- ]office/i.test(text) : true);
    const must = f.must_have_skills ?? [];
    const hallucinated = must.filter((s) => !skillInText(s, text));
    check(title, "must-skills grounded (≥80%)", must.length ? hallucinated.length / must.length <= 0.2 : null, hallucinated.slice(0, 3).join("; "));
    const summ = f.summary ?? "";
    check(title, "summary present ≥60 chars", summ.length >= 60, `${summ.length}ch`);
    check(title, "summary is synthesis, not a JD slice", summ.length >= 60 ? !norm(text).includes(norm(summ.slice(0, 80))) : null);

    // ---- vector sanity vs the title's own signals ----
    const scores = Object.values(v).map((p) => p?.score).filter((s): s is number => typeof s === "number");
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const spread = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length || 1));
    check(title, "vector not flat (spread ≥0.08)", spread >= 0.08, spread.toFixed(3));
    const t = title.toLowerCase();
    if (/staff|principal|senior staff|director|head of/.test(t)) check(title, "senior title → req_seniority ≥0.6", (v.req_seniority?.score ?? 0) >= 0.6, String(v.req_seniority?.score));
    if (/\bmanager\b|head of|director/.test(t) && !/program|product/.test(t)) check(title, "manager title → req_leadership ≥0.5", (v.req_leadership?.score ?? 0) >= 0.5, String(v.req_leadership?.score));
    if (/engineer|scientist|developer/.test(t) && !/manager|director|success|sales/.test(t)) check(title, "IC eng title → req_leadership ≤0.5", (v.req_leadership?.score ?? 1) <= 0.5, String(v.req_leadership?.score));
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`checks run: ${tally.checks}   failed: ${tally.fails}   pass rate: ${(100 * (1 - tally.fails / Math.max(1, tally.checks))).toFixed(1)}%`);
  console.log(`needs_review rate: ${flagged}/${rows.length} (v2 was ~100%; target: rare)`);

  // ---- two full spot-reads for human eyes ----
  for (const r of rows.slice(0, 2)) {
    const f = (r.facts ?? {}) as Facts;
    const v = (r.vector ?? {}) as Vec;
    console.log(`\n──── SPOT-READ: ${r.title} @ ${r.company} ────`);
    console.log(`JD excerpt: ${(r.rawText ?? "").replace(/\s+/g, " ").slice(0, 320)}…`);
    console.log(`summary:    ${f.summary}`);
    console.log(`must:       ${(f.must_have_skills ?? []).join(" · ")}`);
    console.log(`nice:       ${(f.nice_to_have_skills ?? []).join(" · ")}`);
    console.log(`comp ${f.comp_min}–${f.comp_max} ${f.comp_currency} · yrs ${f.min_years_experience} · remote ${f.remote} · country ${f.country} · review ${f.needs_review}`);
    console.log(`vector:     ${Object.entries(v).map(([k, p]) => `${k.replace(/^(req|off)_/, "")}=${p?.score?.toFixed(2)}`).join(" ")}`);
  }
  process.exit(tally.fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
