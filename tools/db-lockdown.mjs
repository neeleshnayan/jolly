/**
 * Lock the Supabase DB against its auto-generated public APIs (PostgREST /
 * GraphQL). Without RLS, ANY table in the public schema is readable/writable
 * by anyone holding the project's anon key — Supabase's linter flags exactly
 * this. The app itself connects as the `postgres` role (table owner), which
 * is unaffected by RLS, so this is pure lockdown with zero app impact.
 *
 *   1. ENABLE ROW LEVEL SECURITY on every public table (no policies = deny
 *      all for non-owner roles)
 *   2. REVOKE existing grants from anon + authenticated
 *   3. REVOKE default privileges so FUTURE tables are born locked
 *
 * Idempotent — safe to re-run. node tools/db-lockdown.mjs
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

const sql = postgres(envLocal("DIRECT_URL") ?? envLocal("DATABASE_URL"), { max: 1, connect_timeout: 15 });

const tables = await sql`select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`;
console.log(`${tables.length} public table(s)`);

for (const t of tables) {
  if (t.rowsecurity) {
    console.log(`  = ${t.tablename} (RLS already on)`);
    continue;
  }
  await sql.unsafe(`ALTER TABLE public."${t.tablename}" ENABLE ROW LEVEL SECURITY`);
  console.log(`  + ${t.tablename} → RLS enabled`);
}

// belt & braces: strip the PostgREST roles' grants entirely (RLS-with-no-
// policies already denies, but revoked grants also silence the linter and
// cover any future FORCE/policy mistakes)
for (const stmt of [
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated`,
  `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated`,
  `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated`,
]) {
  await sql.unsafe(stmt);
  console.log(`  ✓ ${stmt.slice(0, 70)}`);
}

// verify: every table has RLS on and anon can select nothing
const after = await sql`
  select tablename,
         rowsecurity,
         has_table_privilege('anon', 'public."' || tablename || '"', 'SELECT') as anon_select
  from pg_tables where schemaname = 'public' order by tablename`;
let bad = 0;
for (const t of after) {
  const ok = t.rowsecurity && !t.anon_select;
  if (!ok) bad++;
  console.log(`  ${ok ? "✓" : "✗"} ${t.tablename}  rls:${t.rowsecurity}  anon_select:${t.anon_select}`);
}
console.log(bad === 0 ? "\nLOCKED: RLS on everywhere, anon has zero table privileges." : `\n${bad} table(s) still exposed!`);
await sql.end();
process.exit(bad === 0 ? 0 : 1);
