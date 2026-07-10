/**
 * Fill the embedding column for already-extracted rows without re-running gemma
 * (nomic is ~50ms; the whole pool is a couple minutes). Idempotent: only rows
 * with facts but no embedding. The sweep generates embeddings inline for new
 * rows — this is for the ones extracted before the column existed, and to
 * re-embed everything cheaply if we ever change roleEmbedText.
 *   npx tsx tools/embed-backfill.ts            # fill missing
 *   npx tsx tools/embed-backfill.ts --all      # re-embed every vectorized row
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
const ALL = process.argv.includes("--all");

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { and, isNull, isNotNull, sql, eq } = await import("drizzle-orm");
  const { embed, roleEmbedText } = await import("../src/lib/embeddings");

  const rows = await db
    .select({ id: opportunities.id, title: opportunities.title, facts: opportunities.facts })
    .from(opportunities)
    .where(and(isNotNull(opportunities.vectorizedAt), ALL ? sql`true` : isNull(opportunities.embedding)));

  console.log(`embedding ${rows.length} rows${ALL ? " (re-embed all)" : " (missing only)"}…`);
  const BATCH = 32;
  let done = 0, fail = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const vecs = await embed(batch.map((r) => roleEmbedText((r.facts ?? {}) as Record<string, never>, r.title)));
      await Promise.all(batch.map((r, j) => db.update(opportunities).set({ embedding: vecs[j] }).where(eq(opportunities.id, r.id))));
      done += batch.length;
    } catch (e) { fail += batch.length; console.log(`  ! batch ${i} — ${(e as Error).message.slice(0, 50)}`); }
    if (i % (BATCH * 8) === 0) process.stdout.write(`\r  ${done}/${rows.length}`);
  }
  console.log(`\ndone: ${done} embedded, ${fail} failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
