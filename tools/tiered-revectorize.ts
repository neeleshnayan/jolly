/**
 * Tiered re-vectorise — cheap-fast model first, escalate its misses to the
 * strong-reliable model. Granite (~6s/job) handles the bulk; when its extraction
 * comes back INCOMPLETE (empty skills — its known failure mode), the row is
 * flagged needs_strong_pass and gemma3 (~25s/job) redoes it. State lives in the
 * DB, so a crash mid-run resumes exactly where it stopped: rows the fast model
 * finished are stamped, escalated rows are flagged, nothing is re-done or missed.
 *
 *   npx tsx tools/tiered-revectorize.ts                       # granite → gemma3
 *   npx tsx tools/tiered-revectorize.ts --limit=10            # small validation
 *   npx tsx tools/tiered-revectorize.ts --fast=granite4.1:8b --strong=gemma3:27b
 *
 * Reusable beyond this pass: the standard ingestion path for new jobs.
 */
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) { const q = v[0]; const e = v.indexOf(q, 1); v = e > 0 ? v.slice(1, e) : v.slice(1); }
    else { const h = v.indexOf(" #"); if (h >= 0) v = v.slice(0, h).trim(); }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

const FAST = arg("fast") ?? "granite4.1:8b";
const STRONG = arg("strong") ?? "gemma3:27b";
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const BATCH = 5;

type Facts = { must_have_skills?: string[]; nice_to_have_skills?: string[]; summary?: string };

async function main() {
  loadEnvLocal();
  process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  // one model resident at a time; keep it warm across its whole pass
  process.env.OLLAMA_EXTRACT_KEEP_ALIVE = "15m";

  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { and, asc, eq, isNotNull, lt, ne, sql } = await import("drizzle-orm");
  const { getProvider } = await import("@/llm");
  const { VECTORIZE_PROMPT, vectorizeJsonSchema } = await import("@/agents/opportunity-vectorizer");
  const { opportunityExtraction } = await import("@/lib/opportunities/schema");
  const { sanitize } = await import("@/agents/jd-keywords");

  // scrub the model's skills (drops sentences/traits/degree/duration; a 55-char
  // cap keeps compound skills like "Advanced Retrieval Augmented Generation").
  // Mutates facts to the clean lists and returns the surviving must-skill count —
  // <2 means the fast model gave mostly junk, so escalate to the strong model.
  function cleanSkills(facts: Facts): number {
    const must = sanitize(facts.must_have_skills ?? [], 55);
    facts.must_have_skills = must;
    facts.nice_to_have_skills = sanitize(facts.nice_to_have_skills ?? [], 55);
    return must.length;
  }
  const summaryOk = (f: Facts) => (f.summary?.trim().length ?? 0) > 20;

  const provider = getProvider("vectorize");
  const schema = vectorizeJsonSchema();
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const cutoff = new Date();

  type Row = { id: string; title: string | null; company: string | null; location: string | null; rawText: string | null; source: string };

  async function runOne(row: Row, model: string) {
    const res = await provider.extractStructured({
      schemaName: "vectorize_role",
      jsonSchema: schema,
      prompt: VECTORIZE_PROMPT + (row.rawText ?? "").slice(0, 16000),
      numCtx: 16384,
      maxTokens: 4500,
      model,
      keepAlive: "15m",
    });
    return opportunityExtraction.parse(res.data);
  }

  async function write(row: Row, out: Awaited<ReturnType<typeof runOne>>, model: string) {
    // board rows: the ATS's own header fields are authoritative (matches revectorize)
    if (row.source !== "other") {
      out.facts.title = row.title || out.facts.title;
      out.facts.company = row.company || out.facts.company;
      out.facts.location = row.location ?? out.facts.location;
    }
    await db.update(opportunities).set({
      vector: out.vector,
      facts: out.facts,
      remote: out.facts.remote ?? undefined,
      compMin: out.facts.comp_min ?? null,
      compMax: out.facts.comp_max ?? null,
      companyStage: out.facts.company_stage,
      domain: out.facts.domain || null,
      vectorizedAt: sql`now()`,
      needsStrongPass: false,
      vectorizeModel: model,
    }).where(eq(opportunities.id, row.id));
  }

  const unload = (model: string) =>
    fetch(`${base}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});

  // -------- Pass 1: FAST model over stale, not-yet-escalated rows --------
  console.log(`\n=== Pass 1 — ${FAST} (fast) ===`);
  let done1 = 0, escalated = 0, processed = 0;
  for (;;) {
    if (processed >= LIMIT) break;
    const batch = (await db
      .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, location: opportunities.location, rawText: opportunities.rawText, source: opportunities.source })
      .from(opportunities)
      .where(and(isNotNull(opportunities.vectorizedAt), lt(opportunities.vectorizedAt, cutoff), eq(opportunities.needsStrongPass, false), ne(opportunities.source, "sample")))
      .orderBy(asc(opportunities.vectorizedAt))
      .limit(BATCH)) as Row[];
    if (!batch.length) break;
    for (const row of batch) {
      if (processed >= LIMIT) break;
      processed++;
      try {
        const out = await runOne(row, FAST);
        const clean = cleanSkills(out.facts as Facts); // scrub + count real skills
        if (clean >= 2 && summaryOk(out.facts as Facts)) {
          await write(row, out, FAST);
          done1++;
          console.log(`  ✓ ${row.title} — ${clean} skills`);
        } else {
          await db.update(opportunities).set({ needsStrongPass: true }).where(eq(opportunities.id, row.id));
          escalated++;
          console.log(`  ↑ ${row.title} — ${clean} clean skills, escalated`);
        }
      } catch (e) {
        await db.update(opportunities).set({ needsStrongPass: true }).where(eq(opportunities.id, row.id));
        escalated++;
        console.log(`  ↑ ${row.title} — ${(e as Error).message.slice(0, 60)}, escalated`);
      }
    }
  }
  await unload(FAST);
  console.log(`Pass 1: ${done1} done by ${FAST}, ${escalated} escalated`);

  // -------- Pass 2: STRONG model over everything the fast model punted --------
  console.log(`\n=== Pass 2 — ${STRONG} (strong) ===`);
  let done2 = 0, failed2 = 0, processed2 = 0;
  for (;;) {
    if (processed2 >= LIMIT) break;
    const batch = (await db
      .select({ id: opportunities.id, title: opportunities.title, company: opportunities.company, location: opportunities.location, rawText: opportunities.rawText, source: opportunities.source })
      .from(opportunities)
      .where(and(eq(opportunities.needsStrongPass, true), ne(opportunities.source, "sample")))
      .limit(BATCH)) as Row[];
    if (!batch.length) break;
    for (const row of batch) {
      if (processed2 >= LIMIT) break;
      processed2++;
      try {
        const out = await runOne(row, STRONG);
        const clean = cleanSkills(out.facts as Facts); // scrub the strong model's skills too
        await write(row, out, STRONG); // write clears needs_strong_pass
        done2++;
        console.log(`  ✓ ${row.title} — ${clean} skills`);
      } catch (e) {
        failed2++;
        console.log(`  ! ${row.title} — ${(e as Error).message.slice(0, 60)} (stays flagged, retried next run)`);
      }
    }
    await new Promise((r) => setTimeout(r, 10000)); // gemma3 is heavy — breathe between batches
  }
  await unload(STRONG);
  console.log(`Pass 2: ${done2} done by ${STRONG}, ${failed2} still flagged`);
  console.log(`\nTotal re-vectorised: ${done1 + done2}  (fast ${done1} / strong ${done2})`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
