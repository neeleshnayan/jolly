/**
 * nomic vs bge — does Cloudflare's on-platform embedder rank roles like our local
 * nomic? If yes, bge WINS: it runs on CF, so we delete the whole nomic/4090
 * embedding dependency (no sweep, no local embed, real-time-in-call for free).
 *
 * Method: pull a sample of real roles + a handful of target directions. Embed
 * both with nomic (local ollama) and bge (CF Workers AI), using each model's
 * own query/passage convention. For every direction, rank the roles under each
 * model and compare: top-K overlap + Spearman rank correlation. High agreement
 * → bge is good enough → migrate. See docs/adr-001-ranking-funnel.md.
 *
 *   npx tsx tools/embed-compare.ts [--n 150] [--model bge-base]
 */
import { readFileSync } from "node:fs";
import { roleEmbedText, directionEmbedText } from "@/lib/embeddings";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) { const q = v[0]; const e = v.indexOf(q, 1); v = e > 0 ? v.slice(1, e) : v.slice(1); }
    else { const h = v.indexOf(" #"); if (h >= 0) v = v.slice(0, h).trim(); }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const arg = (flag: string, def: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; };
const N = Number(arg("--n", "150"));
const BGE_MODEL = `@cf/baai/${arg("--model", "bge-base")}-en-v1.5`; // bge-base (768d) ~ nomic dims

// directions that span domains — a discriminative test set
const DIRECTIONS = [
  "Product Architect in Web3 / FinTech, designing foundational payment systems",
  "Senior Backend Engineer building distributed systems at scale",
  "Product Manager for an AI product, 0-to-1",
  "Machine Learning Engineer / Data Scientist shipping models",
  "Enterprise Sales Account Executive selling B2B SaaS",
  "Engineering Manager leading a platform team",
];

function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function nomicEmbed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fetch("http://localhost:11434/api/embed", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", input: texts.slice(i, i + 64) }),
    });
    if (!r.ok) throw new Error(`nomic ${r.status}`);
    out.push(...((await r.json()) as { embeddings: number[][] }).embeddings);
  }
  return out;
}

async function bgeEmbed(texts: string[]): Promise<number[][]> {
  const acct = process.env.CF_ACCOUNT_ID!, token = process.env.CF_API_TOKEN!;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${BGE_MODEL}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: texts.slice(i, i + 50) }),
    });
    const j = (await r.json()) as { success: boolean; result?: { data: number[][] }; errors?: unknown };
    if (!j.success || !j.result) throw new Error(`bge: ${JSON.stringify(j.errors)}`);
    out.push(...j.result.data);
  }
  return out;
}

// ranking helpers
const rankOrder = (sims: number[]) => sims.map((s, i) => [i, s] as const).sort((a, b) => b[1] - a[1]).map(([i]) => i);
const overlap = (a: number[], b: number[], k: number) => {
  const sa = new Set(a.slice(0, k));
  return b.slice(0, k).filter((x) => sa.has(x)).length / k;
};
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const ra = Array(n), rb = Array(n);
  rankOrder(a).forEach((idx, r) => (ra[idx] = r));
  rankOrder(b).forEach((idx, r) => (rb[idx] = r));
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

async function main() {
  loadEnvLocal();
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 2 });
  const rows = await sql<{ id: string; title: string | null; domain: string | null; facts: unknown }[]>`
    SELECT id, title, domain, facts FROM opportunities
    WHERE vectorized_at IS NOT NULL AND embedding_vec IS NOT NULL
    ORDER BY created_at DESC LIMIT ${N}`;
  await sql.end();
  console.log(`comparing nomic vs ${BGE_MODEL} on ${rows.length} roles × ${DIRECTIONS.length} directions\n`);

  const roleTexts = rows.map((r) => roleEmbedText((r.facts ?? {}) as Parameters<typeof roleEmbedText>[0], r.title));
  const bgeRoleTexts = roleTexts.map((t) => t.replace(/^search_document:\s*/, ""));
  const nomicDirTexts = DIRECTIONS.map((d) => directionEmbedText(d, []));
  const bgeDirTexts = DIRECTIONS.map((d) => `Represent this sentence for searching relevant passages: ${d}`);

  console.log("embedding roles (nomic + bge)…");
  const [nRoles, bRoles] = await Promise.all([nomicEmbed(roleTexts), bgeEmbed(bgeRoleTexts)]);
  console.log("embedding directions…");
  const [nDirs, bDirs] = await Promise.all([nomicEmbed(nomicDirTexts), bgeEmbed(bgeDirTexts)]);

  let sumTop10 = 0, sumTop20 = 0, sumSpear = 0;
  for (let d = 0; d < DIRECTIONS.length; d++) {
    const nSims = nRoles.map((v) => cosine(nDirs[d], v));
    const bSims = bRoles.map((v) => cosine(bDirs[d], v));
    const nRank = rankOrder(nSims), bRank = rankOrder(bSims);
    const t10 = overlap(nRank, bRank, 10), t20 = overlap(nRank, bRank, 20), sp = spearman(nSims, bSims);
    sumTop10 += t10; sumTop20 += t20; sumSpear += sp;
    console.log(`\n▸ ${DIRECTIONS[d].slice(0, 52)}`);
    console.log(`   top10 overlap ${(t10 * 100).toFixed(0)}%  top20 ${(t20 * 100).toFixed(0)}%  spearman ${sp.toFixed(2)}`);
    console.log(`   nomic top5: ${nRank.slice(0, 5).map((i) => rows[i].title?.slice(0, 26)).join(" | ")}`);
    console.log(`   bge   top5: ${bRank.slice(0, 5).map((i) => rows[i].title?.slice(0, 26)).join(" | ")}`);
  }
  const k = DIRECTIONS.length;
  console.log(`\n${"=".repeat(64)}`);
  console.log(`AGGREGATE — top10 ${(100 * sumTop10 / k).toFixed(0)}%  top20 ${(100 * sumTop20 / k).toFixed(0)}%  spearman ${(sumSpear / k).toFixed(2)}`);
  const verdict = sumTop10 / k >= 0.7 && sumSpear / k >= 0.75;
  console.log(verdict
    ? "→ VERDICT: bge tracks nomic closely — safe to migrate to bge (kill nomic/4090)."
    : "→ VERDICT: bge diverges from nomic — keep nomic for the pool; bge only for real-time-in-call.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
