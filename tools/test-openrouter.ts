/**
 * Prove OpenRouter end-to-end for the highest-value handoff artifact — the
 * cover letter — WITHOUT changing any app config. Routes just this one call
 * in-process (LLM_PROVIDER stays whatever .env.local says). Prints the letter,
 * hooks, model, latency, and token usage so we can eyeball frontier vs gemma4.
 *   npx tsx tools/test-openrouter.ts
 */
import { readFileSync } from "node:fs";

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

async function main() {
  loadEnvLocal();
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not in .env.local");
  // route ONLY this run's cover_letter task to OpenRouter — in-process, nothing persisted
  process.env.LLM_PROVIDER_COVER_LETTER = "openrouter";

  const userId = "80f8584f-99b0-403e-82e5-fa4d1cee9eb2";
  const { getFullProfile } = await import("@/lib/profile/read");
  const { getMentorMap } = await import("@/lib/profile/map");
  const { buildProfileText } = await import("@/lib/scoring/profileText");
  const { runAgent } = await import("@/agents/run");
  const { coverLetterWriter } = await import("@/agents/cover-letter");

  const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
  if (!full) throw new Error("no profile");
  const profileText = buildProfileText(full, map.insights);

  const jd =
    "Data Platform Engineer at Figma. Build the foundational data + ML platform " +
    "that brings AI capabilities into the product. You'll own feature pipelines, " +
    "model serving, CI/CD for models, and self-serve analytics for product teams. " +
    "Strong Python, cloud architecture, and a track record shipping production data tools.";

  console.log(`Model: ${process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5"} (via OpenRouter)\n`);
  const t0 = Date.now();
  const { output, usage } = await runAgent(coverLetterWriter, { profileText, jd }, { userId });
  const ms = Date.now() - t0;

  // same cleanup the route applies
  const letter = output.letter.replace(/\*\*?([^*\n]+)\*\*?/g, "$1").replace(/__([^_\n]+)__/g, "$1");
  console.log("── COVER LETTER ─────────────────────────────────────────────");
  console.log(letter);
  console.log("\n── HOOKS ────────────────────────────────────────────────────");
  for (const h of output.hooks ?? []) console.log(` • ${h}`);
  console.log(`\n${ms}ms · in ${usage?.inputTokens ?? "?"} tok / out ${usage?.outputTokens ?? "?"} tok · ${usage?.model ?? "?"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
