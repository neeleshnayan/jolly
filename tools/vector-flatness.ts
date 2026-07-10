/**
 * Is a model actually DIFFERENTIATING roles, or emitting the same safe score
 * everywhere? Per vectorize_model: per-row spread across the 12 axes (a flat
 * row can't be ranked) and per-axis spread across rows (a flat axis carries no
 * signal). npx tsx tools/vector-flatness.ts
 */
import { readFileSync } from "node:fs";
function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) { const q = v[0]; const e = v.indexOf(q, 1); v = e > 0 ? v.slice(1, e) : v.slice(1); }
    else { const h = v.indexOf(" #"); if (h >= 0) v = v.slice(0, h).trim(); }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { isNotNull, ne, and } = await import("drizzle-orm");

  const rows = await db
    .select({ model: opportunities.vectorizeModel, vector: opportunities.vector, title: opportunities.title, facts: opportunities.facts })
    .from(opportunities)
    .where(and(isNotNull(opportunities.vector), ne(opportunities.source, "sample")));

  type Axes = Record<string, { score?: number }>;
  const byModel = new Map<string, { rowStd: number[]; axis: Map<string, number[]>; n: number; flat: number; all: number[] }>();

  for (const r of rows) {
    const pv = (r.facts as { prompt_v?: number } | null)?.prompt_v ?? 1;
    const model = `${r.model ?? "(pre-tiered/unknown)"}@v${pv}`;
    const v = (r.vector ?? {}) as Axes;
    const scores = Object.entries(v)
      .map(([k, x]) => [k, typeof x?.score === "number" ? x.score : null] as const)
      .filter((x): x is readonly [string, number] => x[1] !== null);
    if (scores.length < 6) continue;
    const vals = scores.map(([, s]) => s);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    let m = byModel.get(model);
    if (!m) byModel.set(model, (m = { rowStd: [], axis: new Map(), n: 0, flat: 0, all: [] }));
    m.n++;
    m.rowStd.push(std);
    m.all.push(...vals);
    if (std < 0.08) m.flat++; // all 12 axes within a whisker of each other
    for (const [k, s] of scores) {
      if (!m.axis.has(k)) m.axis.set(k, []);
      m.axis.get(k)!.push(s);
    }
  }

  const stats = (a: number[]) => {
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    const std = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
    return { mean, std };
  };

  for (const [model, m] of byModel) {
    const rs = stats(m.rowStd);
    const all = stats(m.all);
    const in06 = m.all.filter((s) => s >= 0.55 && s <= 0.65).length / m.all.length;
    console.log(`\n=== ${model} — ${m.n} rows ===`);
    console.log(`  all scores:        mean ${all.mean.toFixed(3)}  std ${all.std.toFixed(3)}   ${(in06 * 100).toFixed(0)}% land in [0.55,0.65]`);
    console.log(`  per-row spread:    median-ish ${rs.mean.toFixed(3)}   FLAT rows (spread<0.08): ${m.flat}/${m.n} (${((100 * m.flat) / m.n).toFixed(0)}%)`);
    console.log(`  per-axis (mean±std across rows) — a dead axis has std≈0:`);
    for (const [k, a] of [...m.axis.entries()].sort()) {
      const s = stats(a);
      const dead = s.std < 0.06 ? "  ← DEAD" : "";
      console.log(`    ${k.padEnd(24)} ${s.mean.toFixed(2)} ± ${s.std.toFixed(3)}${dead}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
