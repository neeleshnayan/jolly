/**
 * One-shot: re-mint the thematic directionTag for every explored-path row so
 * legacy/pre-feature rows (and rows tagged before the prompt got punchier) all
 * carry a consistent tag + proof-point. Idempotent — safe to re-run.
 *
 *   npx tsx tools/backfill-direction-tags.ts             # all users' rows
 *   npx tsx tools/backfill-direction-tags.ts --user <uuid>
 */
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // quoted → take inside the quotes; unquoted → strip any inline `# comment`
    const q = v.match(/^"([^"]*)"/) || v.match(/^'([^']*)'/);
    v = q ? q[1] : v.split(/\s+#/)[0].trim();
    process.env[m[1]] = v;
  }
}
loadEnvLocal();

const userArg = (() => {
  const i = process.argv.indexOf("--user");
  return i >= 0 ? process.argv[i + 1] : null;
})();

// import AFTER env is loaded (db reads DATABASE_URL at module init)
const { db } = await import("@/db");
const { exploredPaths, profiles } = await import("@/db/schema");
const { mintDirectionTag } = await import("@/lib/explored/direction-tag");
const { eq } = await import("drizzle-orm");

let rows = await db.select().from(exploredPaths);
if (userArg) {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userArg)).limit(1);
  rows = p ? rows.filter((r) => r.profileId === p.id) : [];
}

console.log(`re-minting ${rows.length} explored-path row(s)…`);
for (const r of rows) {
  const summary = (r.summary ?? {}) as Record<string, unknown>;
  const why = typeof summary.why === "string" ? summary.why : null;
  const { directionTag, taggedAt } = await mintDirectionTag({ title: r.label, why, kind: r.kind });
  await db.update(exploredPaths).set({ summary: { ...summary, directionTag, taggedAt } }).where(eq(exploredPaths.id, r.id));
  console.log(`  ${r.label}  →  ${directionTag}`);
}
console.log("done.");
process.exit(0);
