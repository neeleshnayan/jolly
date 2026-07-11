/**
 * Phase 1 pgvector migration: enable the extension, add a real vector(768) column
 * alongside the legacy `embedding` jsonb, and backfill it by converting the stored
 * nomic arrays (no re-embedding). Additive + idempotent — safe to re-run. Uses the
 * DIRECT (session) connection, not the pooler, for the DDL.
 */
import { readFileSync } from "node:fs";
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
async function main() {
  loadEnvLocal();
  const { default: postgres } = await import("postgres");
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL!;
  const sql = postgres(url, { prepare: false, max: 1 });
  const step = async (label: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    try { await fn(); console.log(`  ✓ ${label} (${Date.now() - t}ms)`); }
    catch (e) { console.log(`  ✗ ${label}: ${(e as Error).message.slice(0, 140)}`); throw e; }
  };

  await step("CREATE EXTENSION vector", () => sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await step("ADD COLUMN embedding_vec vector(768)", () => sql`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS embedding_vec vector(768)`);

  const [{ n: need }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM opportunities WHERE embedding IS NOT NULL AND embedding_vec IS NULL`;
  console.log(`  backfilling ${need} rows (jsonb → vector)…`);
  await step("backfill embedding_vec", () => sql`
    UPDATE opportunities SET embedding_vec = (embedding::text)::vector
    WHERE embedding IS NOT NULL AND embedding_vec IS NULL`);

  await step("HNSW cosine index", () => sql`
    CREATE INDEX IF NOT EXISTS opportunities_embedding_vec_idx
    ON opportunities USING hnsw (embedding_vec vector_cosine_ops)`);

  const [{ total, withvec }] = await sql<{ total: number; withvec: number }[]>`
    SELECT count(*)::int AS total, count(embedding_vec)::int AS withvec FROM opportunities`;
  console.log(`\nDONE — ${withvec}/${total} opportunities now have a vector column.`);
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
