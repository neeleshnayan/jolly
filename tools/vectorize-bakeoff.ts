/**
 * Model bake-off for the ONE-TIME job vectorisation. Runs the exact production
 * extraction (VECTORIZE_PROMPT + schema) over a sample of real JDs against two
 * or more local models, and prints a side-by-side so we can pick the model whose
 * output is worth paying for once (understand-once, exploit-many).
 *
 *   npx tsx tools/vectorize-bakeoff.ts --models=gemma4:latest --n=5
 *   npx tsx tools/vectorize-bakeoff.ts --models=gemma4:latest,gemma3:27b --n=5
 *
 * One model is resident at a time (kept warm across the sample, then unloaded
 * before the next) so it never doubles up in VRAM. gemma3:27b is ~17GB — only
 * run it with enough free VRAM or it spills to system RAM and crashes the box.
 * Full JSON dump lands in the scratchpad for deeper inspection.
 */
import { readFileSync, writeFileSync } from "node:fs";

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

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

const SCRATCH =
  "C:/Users/user/AppData/Local/Temp/claude/C--Users-user-OneDrive-Documents-Krypton-Fund-Monetization-and-Pricing/a392c072-0c51-493c-aa95-e9026be789aa/scratchpad";

type Facts = {
  location?: string | null;
  country?: string | null;
  remote?: string | null;
  company_stage?: string | null;
  comp_min?: number | null;
  comp_max?: number | null;
  comp_currency?: string | null;
  min_years_experience?: number | null;
  needs_review?: boolean;
  review_reason?: string;
  required_credentials?: string[];
  must_have_skills?: string[];
  nice_to_have_skills?: string[];
  summary?: string;
};

async function unload(base: string, model: string) {
  await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => {});
}

async function main() {
  loadEnvLocal();
  // default to local ollama, but respect an explicit override (e.g. =cloudflare
  // to bake off a CF Workers AI model against the local pool)
  if (!process.env.LLM_PROVIDER_VECTORIZE) process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const models = arg("models", "gemma4:latest").split(",").map((s) => s.trim()).filter(Boolean);
  const stored = arg("stored", ""); // reuse THIS model's extraction from the DB (no re-run) as the baseline
  const n = Number(arg("n", "5"));
  const jdcap = Number(arg("jdcap", "12000")); // chars of JD fed to the model
  const minjd = Number(arg("minjd", "600")); // only sample JDs at least this long
  // must set before importing the provider (it reads OLLAMA_NUM_CTX at module load)
  if (arg("ctx", "")) process.env.OLLAMA_NUM_CTX = arg("ctx", "");
  console.log(`ctx=${process.env.OLLAMA_NUM_CTX ?? 8192} · jdcap=${jdcap} · minjd=${minjd}`);

  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { sql, and, isNotNull, eq } = await import("drizzle-orm");
  const { getProvider } = await import("@/llm");
  const { VECTORIZE_PROMPT, vectorizeJsonSchema } = await import("@/agents/opportunity-vectorizer");

  // a diverse sample: real JDs with enough prose, random across the pool. With
  // --stored=<model>, only sample JDs THAT model already extracted, so we can
  // reuse its stored facts as the baseline instead of re-running it.
  const rows = await db
    .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, location: opportunities.location, rawText: opportunities.rawText, facts: opportunities.facts })
    .from(opportunities)
    .where(and(
      isNotNull(opportunities.rawText),
      sql`length(${opportunities.rawText}) >= ${minjd}`,
      ...(stored ? [isNotNull(opportunities.facts), eq(opportunities.vectorizeModel, stored)] : []),
    ))
    .orderBy(sql`random()`)
    .limit(n);

  const displayModels = stored ? [...models, stored] : models;
  console.log(`Bake-off: ${displayModels.join(" vs ")} on ${rows.length} JD(s)${stored ? ` — ${stored} reused from DB` : ""}\n${"=".repeat(64)}`);

  const provider = getProvider("vectorize");
  const schema = vectorizeJsonSchema();
  // results[rowIdx][model] = { ms, facts } | { error }
  const results: Record<string, Record<string, unknown>>[] = rows.map(() => ({}));

  for (const model of models) {
    console.log(`\n### ${model} — loading & running ${rows.length} extractions…`);
    for (let i = 0; i < rows.length; i++) {
      const jd = (rows[i].rawText ?? "").slice(0, jdcap);
      const t0 = Date.now();
      try {
        const res = await provider.extractStructured({
          schemaName: "vectorize_role",
          jsonSchema: schema,
          prompt: VECTORIZE_PROMPT + jd,
          maxTokens: 3000,
          model,
          keepAlive: "5m", // keep warm across the sample; unloaded after the model's pass
        });
        const ms = Date.now() - t0;
        const facts = ((res.data as { facts?: Facts }).facts ?? {}) as Facts;
        results[i][model] = { ms, facts, tokens: res.usage?.outputTokens ?? null };
        console.log(`  [${i + 1}/${rows.length}] ${rows[i].title} — ${(ms / 1000).toFixed(1)}s, ${facts.must_have_skills?.length ?? 0} must, remote=${facts.remote ?? "—"}, yrs=${facts.min_years_experience ?? "—"}, review=${facts.needs_review ? `YES(${facts.review_reason ?? ""})` : "no"}`);
      } catch (e) {
        results[i][model] = { error: (e as Error).message };
        console.log(`  [${i + 1}/${rows.length}] ${rows[i].title} — ERROR: ${(e as Error).message}`);
      }
    }
    await unload(base, model); // free VRAM before the next model loads
    console.log(`  …${model} unloaded`);
  }

  // stored baseline: reuse the extraction already in the DB (no model run)
  if (stored) {
    for (let i = 0; i < rows.length; i++) {
      results[i][stored] = { ms: null, facts: (rows[i].facts ?? {}) as Facts, fromDb: true };
    }
  }

  // side-by-side, per JD
  console.log(`\n${"=".repeat(64)}\nSIDE BY SIDE\n${"=".repeat(64)}`);
  for (let i = 0; i < rows.length; i++) {
    console.log(`\n■ ${rows[i].title} @ ${rows[i].company}  (location: ${rows[i].location ?? "—"})`);
    for (const model of displayModels) {
      const r = results[i][model] as { ms?: number | null; facts?: Facts; error?: string; fromDb?: boolean };
      if (r.error) { console.log(`  ${model}: ERROR ${r.error}`); continue; }
      const f = r.facts!;
      console.log(`  ${model}  (${r.fromDb ? "stored" : `${((r.ms ?? 0) / 1000).toFixed(1)}s`})`);
      console.log(`     country: ${f.country ?? "—"}   remote: ${f.remote ?? "—"}   stage: ${f.company_stage ?? "—"}   comp: ${f.comp_min ?? "?"}–${f.comp_max ?? "?"} ${f.comp_currency ?? ""}   years: ${f.min_years_experience ?? "—"}`);
      console.log(`     must:  ${(f.must_have_skills ?? []).join(", ")}`);
      console.log(`     nice:  ${(f.nice_to_have_skills ?? []).join(", ")}`);
      console.log(`     summary: ${(f.summary ?? "").slice(0, 180)}`);
    }
  }

  // timing summary
  console.log(`\n${"=".repeat(64)}\nTIMING (avg per JD)`);
  for (const model of models) {
    const times = results.map((r) => (r[model] as { ms?: number })?.ms).filter((x): x is number => typeof x === "number");
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length / 1000 : 0;
    console.log(`  ${model}: ${avg.toFixed(1)}s avg  (${times.length}/${rows.length} ok)`);
  }

  // agreement of each fresh model vs the stored baseline (field-by-field), so a
  // big sample is digestible without eyeballing every JD
  if (stored) {
    console.log(`\n${"=".repeat(64)}\nAGREEMENT vs ${stored} (stored baseline)`);
    const baseFacts = (i: number) => ((results[i][stored] as { facts?: Facts })?.facts ?? {}) as Facts;
    const num = (x: number | null | undefined) => (x ?? null);
    for (const model of models) {
      let ok = 0, country = 0, comp = 0, years = 0, remote = 0, reviewAgree = 0;
      let mustSum = 0, niceSum = 0, baseMust = 0, baseNice = 0, flagged = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = results[i][model] as { facts?: Facts; error?: string };
        if (r.error || !r.facts) continue;
        ok++;
        const a = r.facts, b = baseFacts(i);
        if ((a.country ?? "") === (b.country ?? "")) country++;
        if (num(a.comp_min) === num(b.comp_min) && num(a.comp_max) === num(b.comp_max)) comp++;
        if (num(a.min_years_experience) === num(b.min_years_experience)) years++;
        if ((a.remote ?? "") === (b.remote ?? "")) remote++;
        if (!!a.needs_review === !!b.needs_review) reviewAgree++;
        if (a.needs_review) flagged++;
        mustSum += a.must_have_skills?.length ?? 0;
        niceSum += a.nice_to_have_skills?.length ?? 0;
        baseMust += b.must_have_skills?.length ?? 0;
        baseNice += b.nice_to_have_skills?.length ?? 0;
      }
      const pct = (x: number) => (ok ? `${Math.round((100 * x) / ok)}%` : "—");
      const av = (x: number) => (ok ? (x / ok).toFixed(1) : "—");
      console.log(`\n  ${model} vs ${stored}  (${ok} JDs):`);
      console.log(`    same value → country ${pct(country)} · comp ${pct(comp)} · years ${pct(years)} · remote ${pct(remote)} · needs_review-agree ${pct(reviewAgree)}`);
      console.log(`    avg skills → ${model}: ${av(mustSum)} must / ${av(niceSum)} nice    ${stored}: ${av(baseMust)} must / ${av(baseNice)} nice`);
      console.log(`    ${model} self-flagged needs_review on ${flagged}/${ok}`);
    }
  }

  const out = `${SCRATCH}/vectorize-bakeoff.json`;
  writeFileSync(out, JSON.stringify({ models, rows: rows.map((r, i) => ({ title: r.title, company: r.company, location: r.location, results: results[i] })) }, null, 2));
  console.log(`\nFull dump → ${out}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
