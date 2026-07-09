/**
 * Explain a role's fit % end-to-end: gate, per-axis desire breakdown, and
 * every rank-time factor (comp, location, target boost, drift).
 *   npx tsx tools/why-fit.ts "incident response"
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

const pc = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  loadEnvLocal();
  const query = (process.argv[2] ?? "incident response").toLowerCase();
  const userId = "80f8584f-99b0-403e-82e5-fa4d1cee9eb2";

  const { db } = await import("@/db");
  const { opportunities, profiles } = await import("@/db/schema");
  const { eq, isNotNull, ilike, and } = await import("drizzle-orm");
  const { getSavedScoring } = await import("@/lib/scoring/persist");
  const { learnDrift, applyDrift } = await import("@/lib/opportunities/learn");
  const { scoreMatch } = await import("@/lib/opportunities/match");
  const { rankMatches } = await import("@/lib/opportunities/recommend");

  const [role] = await db
    .select()
    .from(opportunities)
    .where(and(isNotNull(opportunities.vectorizedAt), ilike(opportunities.title, `%${query}%`)))
    .limit(1);
  if (!role) throw new Error(`no vectorized role matching "${query}"`);
  console.log(`ROLE: ${role.title} @ ${role.company}\n`);

  const saved = await getSavedScoring(userId);
  const base = saved.scoring as never;
  const [me] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const drift = me ? await learnDrift(me.id) : null;
  const vec = applyDrift(base, drift);

  for (const [name, v] of [["BASE vector", base], ["DRIFTED vector", vec]] as const) {
    const m = scoreMatch(v as never, (role.vector ?? {}) as never);
    console.log(`--- ${name} → fit ${pc(m.fit)} (gate side: qual ${pc(m.qualification)}, desire ${pc(m.desire)})`);
    for (const a of m.breakdown) {
      const kind = a.key.startsWith("q_") ? "QUAL  " : "DESIRE";
      console.log(
        `  ${kind} ${a.label.padEnd(18)} you=${a.user.toFixed(2)} role=${a.role.toFixed(2)} weight=${a.weight.toFixed(2)} axis-fit=${a.fit.toFixed(3)}`,
      );
    }
    console.log();
  }
  if (drift) console.log(`drift: ${drift.events} events, confidence ${drift.confidence.toFixed(2)}\n`);

  // what the app actually shows (all factors applied)
  const ranked = await rankMatches(userId);
  const idx = ranked.findIndex((j) => j.id === role.id);
  const j = ranked[idx];
  if (j) {
    console.log(`SHOWN IN APP: rank #${idx + 1}, fit ${pc(j.fit)}`);
    console.log(`  reasons: ${j.reasons.join(" | ")}`);
    console.log(`  gaps:    ${j.gaps.join(" | ") || "(none)"}`);
  } else {
    console.log("role not in ranked list (gated or dismissed)");
  }
  // context: where does the whole distribution sit?
  const fits = ranked.map((r) => r.fit).sort((a, b) => b - a);
  const at = (q: number) => pc(fits[Math.min(fits.length - 1, Math.floor(q * fits.length))]);
  console.log(`\nDISTRIBUTION over ${fits.length} ranked roles: max ${pc(fits[0])} | p25 ${at(0.25)} | median ${at(0.5)} | p75 ${at(0.75)} | min ${pc(fits[fits.length - 1])}`);
  console.log(`roles shown at >=90%: ${fits.filter((f) => f >= 0.9).length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
