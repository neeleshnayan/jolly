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
  comp_min?: number | null;
  comp_max?: number | null;
  comp_currency?: string | null;
  min_years_experience?: number | null;
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
  process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const models = arg("models", "gemma4:latest").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number(arg("n", "5"));
  const jdcap = Number(arg("jdcap", "12000")); // chars of JD fed to the model
  const minjd = Number(arg("minjd", "600")); // only sample JDs at least this long
  // must set before importing the provider (it reads OLLAMA_NUM_CTX at module load)
  if (arg("ctx", "")) process.env.OLLAMA_NUM_CTX = arg("ctx", "");
  console.log(`ctx=${process.env.OLLAMA_NUM_CTX ?? 8192} · jdcap=${jdcap} · minjd=${minjd}`);

  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { sql, and, isNotNull } = await import("drizzle-orm");
  const { getProvider } = await import("@/llm");
  const { VECTORIZE_PROMPT, vectorizeJsonSchema } = await import("@/agents/opportunity-vectorizer");

  // a diverse sample: real JDs with enough prose, random across the pool
  const rows = await db
    .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, location: opportunities.location, rawText: opportunities.rawText })
    .from(opportunities)
    .where(and(isNotNull(opportunities.rawText), sql`length(${opportunities.rawText}) >= ${minjd}`))
    .orderBy(sql`random()`)
    .limit(n);

  console.log(`Bake-off: ${models.join(" vs ")} on ${rows.length} JD(s)\n${"=".repeat(64)}`);

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
        console.log(`  [${i + 1}/${rows.length}] ${rows[i].title} — ${(ms / 1000).toFixed(1)}s, ${facts.must_have_skills?.length ?? 0} must / ${facts.nice_to_have_skills?.length ?? 0} nice, country=${facts.country ?? "—"}`);
      } catch (e) {
        results[i][model] = { error: (e as Error).message };
        console.log(`  [${i + 1}/${rows.length}] ${rows[i].title} — ERROR: ${(e as Error).message}`);
      }
    }
    await unload(base, model); // free VRAM before the next model loads
    console.log(`  …${model} unloaded`);
  }

  // side-by-side, per JD
  console.log(`\n${"=".repeat(64)}\nSIDE BY SIDE\n${"=".repeat(64)}`);
  for (let i = 0; i < rows.length; i++) {
    console.log(`\n■ ${rows[i].title} @ ${rows[i].company}  (location: ${rows[i].location ?? "—"})`);
    for (const model of models) {
      const r = results[i][model] as { ms?: number; facts?: Facts; error?: string };
      if (r.error) { console.log(`  ${model}: ERROR ${r.error}`); continue; }
      const f = r.facts!;
      console.log(`  ${model}  (${((r.ms ?? 0) / 1000).toFixed(1)}s)`);
      console.log(`     country: ${f.country ?? "—"}   comp: ${f.comp_min ?? "?"}–${f.comp_max ?? "?"} ${f.comp_currency ?? ""}   years: ${f.min_years_experience ?? "—"}   creds: [${(f.required_credentials ?? []).join(", ")}]`);
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

  const out = `${SCRATCH}/vectorize-bakeoff.json`;
  writeFileSync(out, JSON.stringify({ models, rows: rows.map((r, i) => ({ title: r.title, company: r.company, location: r.location, results: results[i] })) }, null, 2));
  console.log(`\nFull dump → ${out}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
