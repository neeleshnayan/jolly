/**
 * SOURCE PILOT — compare job-data providers on QUALITY before integrating one.
 * Fetches a sample from Adzuna + Fantastic.jobs, normalizes, and scores each on
 * the things that matter for drizzle's honesty bar: comp coverage, remote-stated,
 * apply-URL present, dedup rate, freshness, description richness, and ghost-job
 * signals (staffing-agency names, missing url, stale/absent date). Direct-ATS
 * (the current pool) is the baseline.
 *
 * Phase A (source quality) needs NO GPU. Phase B (--extract) runs the v6
 * extractRole on a few rows per source to see how cleanly the pipeline handles
 * each — needs Ollama up.
 *
 * Keys (free-tier signups — add to .env.local; I can't create the accounts):
 *   ADZUNA_APP_ID, ADZUNA_APP_KEY        (adzuna.com/developer — generous free tier + salary)
 *   FANTASTIC_JOBS_KEY                    (RapidAPI key for the Fantastic Jobs / Active Jobs DB)
 *   FANTASTIC_JOBS_HOST (optional)        default: active-jobs-db.p.rapidapi.com
 *
 *   npx tsx tools/source-pilot.ts --q="data engineer" --n=25 --country=us
 *   npx tsx tools/source-pilot.ts --q="data engineer" --n=8 --extract   # + Phase B
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]?\s*(#.*)?$/g, "");
}
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const Q = arg("q", "data engineer");
const N = Number(arg("n", "25"));
const COUNTRY = arg("country", "us");
const EXTRACT = process.argv.includes("--extract");

type Job = { source: string; title: string; company: string; location: string; desc: string; compMin: number | null; compMax: number | null; currency: string | null; url: string | null; postedAt: string | null; remote: string | null; compPredicted?: boolean };

const STAFFING = /staffing|recruit|talent(?! acquisition team)|consultanc|placement|headhunt|manpower|outsourc|\bRPO\b/i;
const daysAgo = (iso: string | null): number | null => { if (!iso) return null; const t = Date.parse(iso); if (isNaN(t)) return null; return Math.round((Date.parse("2026-07-11") - t) / 86400000); };

async function fetchAdzuna(): Promise<Job[] | null> {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) { console.log("  · Adzuna: no ADZUNA_APP_ID/ADZUNA_APP_KEY — skipped"); return null; }
  const u = `https://api.adzuna.com/v1/api/jobs/${COUNTRY}/search/1?app_id=${id}&app_key=${key}&results_per_page=${N}&what=${encodeURIComponent(Q)}&content-type=application/json`;
  const r = await fetch(u);
  if (!r.ok) { console.log(`  · Adzuna: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); return null; }
  const j = (await r.json()) as { results?: Record<string, unknown>[] };
  const rows = j.results ?? [];
  if (rows[0]) console.log(`  · Adzuna raw[0] keys: ${Object.keys(rows[0]).join(", ")}`);
  return rows.map((x) => ({
    source: "adzuna", title: String(x.title ?? "?"), company: String((x.company as { display_name?: string })?.display_name ?? "?"),
    location: String((x.location as { display_name?: string })?.display_name ?? ""), desc: String(x.description ?? ""),
    compMin: (x.salary_min as number) ?? null, compMax: (x.salary_max as number) ?? null, currency: COUNTRY === "gb" ? "GBP" : COUNTRY === "in" ? "INR" : "USD",
    url: (x.redirect_url as string) ?? null, postedAt: (x.created as string) ?? null, remote: /remote/i.test(String(x.description ?? "") + String(x.title ?? "")) ? "remote" : null,
    compPredicted: x.salary_is_predicted === "1" || x.salary_is_predicted === 1 || x.salary_is_predicted === true,
  }));
}

async function fetchFantastic(): Promise<Job[] | null> {
  const key = process.env.FANTASTIC_JOBS_KEY;
  if (!key) { console.log("  · Fantastic.jobs: no FANTASTIC_JOBS_KEY — skipped"); return null; }
  const host = process.env.FANTASTIC_JOBS_HOST ?? "active-jobs-db.p.rapidapi.com";
  const u = `https://${host}/active-ats-7d?limit=${N}&title_filter=${encodeURIComponent(Q)}&location_filter=${encodeURIComponent(COUNTRY === "us" ? "United States" : COUNTRY)}`;
  const r = await fetch(u, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
  if (!r.ok) { console.log(`  · Fantastic.jobs: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`); return null; }
  const rows = (await r.json()) as Record<string, unknown>[];
  if (!Array.isArray(rows)) { console.log(`  · Fantastic.jobs: unexpected shape — ${JSON.stringify(rows).slice(0, 160)}`); return null; }
  if (rows[0]) console.log(`  · Fantastic raw[0] keys: ${Object.keys(rows[0]).join(", ")}`);
  // defensive mapping — field names vary; adjust after seeing the raw[0] dump
  const loc = (x: Record<string, unknown>) => { const l = x.locations_derived ?? x.locations_raw ?? x.location; return Array.isArray(l) ? String(l[0] ?? "") : String(l ?? ""); };
  const sal = (x: Record<string, unknown>) => { const s = (x.salary_raw ?? x.salary) as { value?: { minValue?: number; maxValue?: number }; minValue?: number; maxValue?: number } | undefined; return { min: s?.value?.minValue ?? s?.minValue ?? null, max: s?.value?.maxValue ?? s?.maxValue ?? null }; };
  return rows.map((x) => { const s = sal(x); return {
    source: "fantastic", title: String(x.title ?? "?"), company: String(x.organization ?? x.company ?? x.company_name ?? "?"),
    location: loc(x), desc: String(x.description ?? x.description_text ?? ""), compMin: s.min, compMax: s.max, currency: null,
    url: (x.url as string) ?? (x.apply_url as string) ?? null, postedAt: (x.date_posted as string) ?? (x.datePosted as string) ?? null,
    remote: (x.remote_derived as boolean) || /remote/i.test(String(x.title ?? "")) ? "remote" : null,
  }; });
}

function analyze(name: string, jobs: Job[]) {
  const n = jobs.length || 1;
  const pct = (c: number) => `${Math.round((100 * c) / n)}%`;
  const seen = new Map<string, number>();
  jobs.forEach((j) => { const k = `${j.title.toLowerCase()}|${j.company.toLowerCase()}`; seen.set(k, (seen.get(k) ?? 0) + 1); });
  const dupes = [...seen.values()].filter((v) => v > 1).reduce((a, v) => a + v, 0);
  const ages = jobs.map((j) => daysAgo(j.postedAt)).filter((d): d is number => d !== null);
  const ghost = jobs.filter((j) => !j.url || STAFFING.test(j.company) || j.company === "?" || (daysAgo(j.postedAt) ?? 0) > 45 || j.desc.length < 300);
  console.log(`\n■ ${name} — ${jobs.length} jobs`);
  const stated = jobs.filter((j) => j.compMax != null || j.compMin != null);
  const predicted = stated.filter((j) => j.compPredicted).length;
  console.log(`   comp stated:   ${pct(stated.length)}${predicted ? `  (⚠ ${Math.round((100 * predicted) / (stated.length || 1))}% ML-PREDICTED, not employer-stated)` : ""}`);
  console.log(`   remote stated: ${pct(jobs.filter((j) => j.remote).length)}`);
  console.log(`   apply URL:     ${pct(jobs.filter((j) => j.url).length)}`);
  console.log(`   has date:      ${pct(jobs.filter((j) => j.postedAt).length)}${ages.length ? ` · median ${ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)]}d old` : ""}`);
  console.log(`   avg desc len:  ${Math.round(jobs.reduce((a, j) => a + j.desc.length, 0) / n)} chars`);
  console.log(`   duplicates:    ${dupes} (${pct(dupes)})`);
  console.log(`   🚩 ghost-ish:  ${ghost.length} (${pct(ghost.length)}) — no url / staffing / stale>45d / thin desc`);
  if (ghost.length) console.log(`      e.g. ${ghost.slice(0, 3).map((g) => `${g.title.slice(0, 28)} @ ${g.company.slice(0, 16)}`).join(" · ")}`);
}

async function main() {
  console.log(`SOURCE PILOT — query "${Q}", n=${N}, country=${COUNTRY}\n${"=".repeat(74)}\nfetching…`);
  const [adz, fan] = await Promise.all([fetchAdzuna().catch((e) => { console.log(`  · Adzuna error: ${e.message}`); return null; }), fetchFantastic().catch((e) => { console.log(`  · Fantastic error: ${e.message}`); return null; })]);

  // direct-ATS baseline from the existing pool (Supabase; no Ollama needed)
  let baseline: Job[] = [];
  try {
    const { db } = await import("../src/db");
    const { opportunities } = await import("../src/db/schema");
    const { sql, ne, and, isNotNull } = await import("drizzle-orm");
    const rows = (await db.select({ title: opportunities.title, company: opportunities.company, location: opportunities.location, rawText: opportunities.rawText, compMin: opportunities.compMin, compMax: opportunities.compMax, url: opportunities.url, source: opportunities.source })
      .from(opportunities).where(and(ne(opportunities.source, "sample"), isNotNull(opportunities.rawText))).orderBy(sql`random()`).limit(N)) as { title: string | null; company: string | null; location: string | null; rawText: string | null; compMin: number | null; compMax: number | null; url: string | null }[];
    baseline = rows.map((r) => ({ source: "direct-ats", title: r.title ?? "?", company: r.company ?? "?", location: r.location ?? "", desc: r.rawText ?? "", compMin: r.compMin, compMax: r.compMax, currency: null, url: r.url, postedAt: null, remote: /remote/i.test(r.rawText ?? "") ? "remote" : null }));
  } catch (e) { console.log(`  · baseline (DB) unavailable: ${(e as Error).message.slice(0, 60)}`); }

  console.log(`\n${"=".repeat(74)}\nSOURCE QUALITY (Phase A — no GPU)`);
  if (baseline.length) analyze("direct-ATS (baseline)", baseline);
  if (adz) analyze("Adzuna", adz);
  if (fan) analyze("Fantastic.jobs", fan);
  if (!adz && !fan) { console.log("\n⚠ No provider keys found. Add ADZUNA_APP_ID/ADZUNA_APP_KEY and/or FANTASTIC_JOBS_KEY to .env.local."); process.exit(0); }

  if (EXTRACT) {
    console.log(`\n${"=".repeat(74)}\nEXTRACTION (Phase B — needs Ollama up)`);
    process.env.LLM_PROVIDER_VECTORIZE = "ollama";
    const { extractRole, applyRowAuthority, STRONG_MODEL } = await import("../src/lib/jobs/vectorize");
    for (const [nm, js] of [["Adzuna", adz], ["Fantastic.jobs", fan]] as const) {
      if (!js) continue;
      console.log(`\n— ${nm} (${STRONG_MODEL}) —`);
      for (const j of js.slice(0, 4)) {
        try { const out = await extractRole(j.desc, STRONG_MODEL); applyRowAuthority(out, { title: j.title, company: j.company, location: j.location, source: nm }); console.log(`   ✓ ${j.title.slice(0, 34)} → td=${out.vector.req_technical_depth?.score} comp=${out.facts.comp_min ?? "∅"}-${out.facts.comp_max ?? "∅"} ${out.facts.comp_currency ?? ""} review=${out.facts.needs_review}`); }
        catch (e) { console.log(`   ✗ ${j.title.slice(0, 34)} — ${(e as Error).message.slice(0, 40)}`); }
      }
    }
  }
  console.log(`\n${"=".repeat(74)}\nRead the ghost-ish % + comp/date coverage: ATS-sourced should be cleaner than aggregators. Re-run with --extract once Ollama is up.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
