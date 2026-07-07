/**
 * Local job worker. Run on your rig:  npm run jobs:fetch
 * Thin CLI wrapper over the shared ingest loop (src/lib/jobs/fetch.ts) — the
 * same loop the admin dashboard's "fetch now" trigger uses. This wrapper just
 * loads .env.local (standalone process, not Next) and pins vectorization local.
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
  process.env.LLM_PROVIDER_VECTORIZE = "ollama"; // the worker always vectorizes locally
  // let the worker use a lighter model than the app's extractor so it can run
  // alongside a live dev server (or set OLLAMA_MAX_LOADED_MODELS=1 to time-share)
  if (process.env.WORKER_OLLAMA_MODEL) process.env.OLLAMA_MODEL = process.env.WORKER_OLLAMA_MODEL;

  // import AFTER env is set (db + provider read env lazily)
  const { fetchRawJobs, runInference } = await import("@/lib/jobs/fetch");
  await fetchRawJobs({ log: console.log });
  // then vectorize pending rows in batches with a cooldown (JOBS_INFER_LIMIT /
  // JOBS_INFER_BATCH / JOBS_INFER_SLEEP_MS to tune)
  await runInference({ log: console.log });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
