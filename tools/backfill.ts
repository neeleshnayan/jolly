/**
 * Headless backfill — the SAME runInference the admin ♻ Backfill button calls,
 * for when you want the sweep without a dev server (overnight runs, cron).
 * Replaced tools/revectorize.ts and tools/tiered-revectorize.ts, whose private
 * copies of the pipeline had drifted (cutoff semantics that re-did final rows).
 * All selection logic lives in ONE place: lib/jobs/fetch (pending + old-schema
 * + untrusted-model + old-prompt; converges to zero, skips finished rows).
 *
 *   npx tsx tools/backfill.ts                 # sweep everything that needs it
 *   npx tsx tools/backfill.ts --limit=50      # bounded run
 *   npx tsx tools/backfill.ts --sleep=0       # no cooldown (watch thermals)
 *
 * Don't run while the dev-server sweep is active — the DB evidence guard in the
 * admin route can't see this process (same GPU, double work).
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
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  loadEnvLocal();
  process.env.LLM_PROVIDER_VECTORIZE = "ollama";
  const { runInference } = await import("@/lib/jobs/fetch");
  const result = await runInference({
    limit: Number(arg("limit") ?? 2000),
    batchSize: Number(arg("batch") ?? 5),
    sleepMs: Number(arg("sleep") ?? 5) * 1000,
    force: true,
    tiered: true,
    log: (line) => console.log(line),
  });
  console.log(`\nvectorized ${result.vectorized}, failed ${result.failed}, ${result.remaining} remaining`);
  process.exit(result.failed > 0 && result.vectorized === 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
