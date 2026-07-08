/**
 * One-off additive migration runner (drizzle-kit's interactive prompts can't
 * run headless). Statements are idempotent — safe to re-run.
 *   node tools/apply-additive-migration.mjs
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

function envLocal(name) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`));
    if (!m) continue;
    let v = m[1].trim();
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0];
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      const hash = v.indexOf(" #");
      if (hash >= 0) v = v.slice(0, hash).trim();
    }
    return v;
  }
  return undefined;
}

const url = envLocal("DIRECT_URL") ?? envLocal("DATABASE_URL");
if (!url) {
  console.error("No DIRECT_URL/DATABASE_URL in .env.local");
  process.exit(1);
}
const sql = postgres(url, { max: 1, connect_timeout: 15 });

const statements = [
  `ALTER TYPE opportunity_source ADD VALUE IF NOT EXISTS 'consider'`,
  `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS about_overrides jsonb DEFAULT '{}'`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS notes text`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS follow_up_at timestamp with time zone`,
  `CREATE TABLE IF NOT EXISTS ranking_signals (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
     profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
     kind text NOT NULL,
     created_at timestamp with time zone DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ranking_signals_profile_kind_idx ON ranking_signals (profile_id, kind)`,
];

for (const s of statements) {
  await sql.unsafe(s);
  console.log("ok:", s.replace(/\s+/g, " ").slice(0, 72));
}
await sql.end();
console.log("done");
