/**
 * Backfill the pool with CF bge-base embeddings into a NEW column (embedding_bge)
 * — additive, non-destructive: the working nomic column (embedding_vec) is left
 * untouched, so this is fully reversible. Step 1 of the nomic→bge consolidation:
 * once the harnesses validate bge (tools/anchors + match-sanity with EMBED_PROVIDER
 * =bge), the ranking flips to embedding_bge and nomic/4090 embedding retires.
 *
 *   npx tsx tools/bge-backfill.ts [--force]   (--force re-embeds rows already done)
 */
import { readFileSync } from "node:fs";
import { roleEmbedText } from "@/lib/embeddings";

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

async function bgeEmbed(texts: string[]): Promise<number[][]> {
  const acct = process.env.CF_ACCOUNT_ID!, token = process.env.CF_API_TOKEN!;
  // bge-base wants the raw passage (no nomic "search_document:" prefix)
  const clean = texts.map((t) => t.replace(/^search_document:\s*/, ""));
  const out: number[][] = [];
  for (let i = 0; i < clean.length; i += 50) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/baai/bge-base-en-v1.5`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: clean.slice(i, i + 50) }),
    });
    const j = (await r.json()) as { success: boolean; result?: { data: number[][] }; errors?: unknown };
    if (!j.success || !j.result) throw new Error(`bge ${r.status}: ${JSON.stringify(j.errors)}`);
    out.push(...j.result.data);
  }
  return out;
}

async function main() {
  loadEnvLocal();
  const force = process.argv.includes("--force");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false, max: 2 });

  await sql`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS embedding_bge vector(768)`;
  const rows = await sql<{ id: string; title: string | null; domain: string | null; facts: unknown }[]>`
    SELECT id, title, domain, facts FROM opportunities
    WHERE vectorized_at IS NOT NULL ${force ? sql`` : sql`AND embedding_bge IS NULL`}`;
  console.log(`bge-backfill: ${rows.length} role(s)${force ? " (force)" : ""}…`);

  let done = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const texts = batch.map((r) => roleEmbedText((r.facts ?? {}) as Parameters<typeof roleEmbedText>[0], r.title));
    const vecs = await bgeEmbed(texts);
    await Promise.all(batch.map((r, j) =>
      sql`UPDATE opportunities SET embedding_bge = ${`[${vecs[j].join(",")}]`}::vector WHERE id = ${r.id}`));
    done += batch.length;
    console.log(`  ${done}/${rows.length}`);
  }
  await sql`CREATE INDEX IF NOT EXISTS opportunities_embedding_bge_idx ON opportunities USING hnsw (embedding_bge vector_cosine_ops)`;
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(embedding_bge)::int AS n FROM opportunities`;
  console.log(`\nDONE — ${n} roles have a bge vector. (nomic embedding_vec untouched.)`);
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
