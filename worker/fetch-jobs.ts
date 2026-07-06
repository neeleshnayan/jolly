/**
 * Local job worker. Run on your rig:  npm run jobs:fetch
 * Pulls roles from the configured ATS boards, dedupes by externalId, vectorizes
 * NEW roles with the LOCAL model (Ollama), and persists them. The app's
 * user-facing inference can go via OpenRouter — this worker stays local + free.
 * Scheduling: run it from cron / Task Scheduler on whatever cadence you like.
 */
import { readFileSync } from "node:fs";

// load .env.local into process.env (this is a standalone process, not Next)
function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      if (/^\s*#/.test(line)) continue; // whole-line comment
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (v.startsWith('"') || v.startsWith("'")) {
        const q = v[0];
        const end = v.indexOf(q, 1);
        v = end > 0 ? v.slice(1, end) : v.slice(1); // quoted → drop the quotes (ignore trailing comment)
      } else {
        const hash = v.indexOf(" #"); // unquoted → strip an inline comment
        if (hash >= 0) v = v.slice(0, hash).trim();
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* no .env.local — rely on the ambient env */
  }
}

async function main() {
  loadEnvLocal();
  process.env.LLM_PROVIDER = "ollama"; // the worker always vectorizes locally
  // let the worker use a lighter model than the app's extractor so it can run
  // alongside a live dev server (or set OLLAMA_MAX_LOADED_MODELS=1 to time-share)
  if (process.env.WORKER_OLLAMA_MODEL) process.env.OLLAMA_MODEL = process.env.WORKER_OLLAMA_MODEL;

  // import AFTER env is set (db + provider read env lazily)
  const { inArray } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { opportunities } = await import("@/db/schema");
  const { runAgent } = await import("@/agents/run");
  const { opportunityVectorizer } = await import("@/agents/opportunity-vectorizer");
  const { persistOpportunity } = await import("@/lib/opportunities/persist");
  const { COMPANIES } = await import("./companies");
  const { fetchBoard } = await import("./ats");

  const cap = Number(process.env.JOBS_CAP ?? 15); // max NEW roles to vectorize per run
  let added = 0;

  for (const c of COMPANIES) {
    if (!c.slug || c.slug.includes("your")) continue;
    let jobs;
    try {
      jobs = await fetchBoard(c.source, c.slug);
    } catch (e) {
      console.warn(`skip ${c.source}:${c.slug} — ${(e as Error).message}`);
      continue;
    }
    console.log(`${c.source}:${c.slug} → ${jobs.length} postings`);

    const ids = jobs.map((j) => j.externalId);
    const existing = ids.length
      ? await db.select({ externalId: opportunities.externalId }).from(opportunities).where(inArray(opportunities.externalId, ids))
      : [];
    const have = new Set(existing.map((e) => e.externalId));

    let consecutiveFails = 0;
    for (const job of jobs) {
      if (added >= cap) break;
      if (consecutiveFails >= 3) {
        console.warn("  (3 failures in a row — likely a config issue; stopping)");
        break;
      }
      if (have.has(job.externalId) || job.jd.length < 80) continue;
      try {
        const { output } = await runAgent(opportunityVectorizer, { jd: job.jd }, { userId: "worker" });
        output.facts.title = job.title || output.facts.title;
        output.facts.company = c.slug;
        output.facts.location = job.location ?? output.facts.location;
        await persistOpportunity({
          extraction: output,
          jd: job.jd,
          url: job.url,
          source: c.source,
          externalId: job.externalId,
        });
        added++;
        consecutiveFails = 0;
        console.log(`  + ${job.title}`);
      } catch (e) {
        consecutiveFails++;
        console.warn(`  ! ${job.title} — ${(e as Error).message}`);
      }
    }
    if (added >= cap) {
      console.log(`(hit cap of ${cap} — run again to continue)`);
      break;
    }
  }

  console.log(`\nDone. Added ${added} new role(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
