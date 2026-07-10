/** Read-only DB hygiene report: duplicates, orphans, stuck rows, junk facts.
 *  npx tsx tools/db-hygiene.ts */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}
async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const q = async (label: string, query: ReturnType<typeof sql>) => {
    const res = (await db.execute(query)) as unknown as Record<string, unknown>[];
    const n = Number(Object.values(res[0] ?? { n: -1 })[0]);
    console.log(`${n === 0 ? "ok " : "⚠ "} ${String(n).padStart(5)}  ${label}`);
    return n;
  };
  await q("duplicate opportunities (same external_id, >1 row)", sql`select count(*)::int as n from (select external_id from opportunities where external_id is not null group by external_id having count(*) > 1) d`);
  await q("ranking signals pointing at deleted opportunities", sql`select count(*)::int as n from ranking_signals rs where not exists (select 1 from opportunities o where o.id = rs.opportunity_id)`);
  // NB: vector/facts default to '{}' (never NULL) — always compare against the
  // empty object, and only for rows that CLAIM to be vectorized
  await q("VECTORIZED rows with empty facts (broken write)", sql`select count(*)::int as n from opportunities where vectorized_at is not null and (facts is null or facts = '{}'::jsonb)`);
  await q("VECTORIZED rows with empty vector (broken write)", sql`select count(*)::int as n from opportunities where vectorized_at is not null and (vector is null or vector = '{}'::jsonb)`);
  await q("rows stuck needs_strong_pass > 24h old", sql`select count(*)::int as n from opportunities where needs_strong_pass and vectorized_at < now() - interval '24 hours'`);
  await q("profiles with no user_id", sql`select count(*)::int as n from profiles where user_id is null`);
  await q("skills rows with empty names", sql`select count(*)::int as n from skills where coalesce(trim(name), '') = ''`);
  await q("opportunities with rawText under 100 chars (unusable for re-vectorise)", sql`select count(*)::int as n from opportunities where raw_text is not null and length(raw_text) < 100 and source <> 'sample'`);
  console.log("\n(read-only — nothing was modified)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
