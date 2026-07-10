/**
 * LOCK TEST for the embedding trajectory before the crunch. Five diverse
 * archetype DIRECTIONS scored against the pool's role embeddings. Two jobs:
 *   1. calibrate — dump the cosine distribution so COS_LO/COS_HI are data-set,
 *      not guessed
 *   2. sanity — each archetype's top roles must semantically match its
 *      direction, and its red-flag discipline must NOT top the list
 *   npx tsx tools/embed-lock.ts
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"].*$/g, "");
}

const ARCH = [
  { name: "backend/infra IC", dir: "Target role: Staff Backend Engineer. Build reliable distributed systems and payment infrastructure at scale, own services end to end.", want: /engineer|infra|platform|backend|systems|sre|developer|software/i, avoid: /account executive|sales|marketing|counsel|recruiter/i },
  { name: "engineering manager", dir: "Target role: Engineering Manager. Lead and grow an engineering team, own delivery, hiring, and people development.", want: /manager|lead|head|director/i, avoid: /account executive|counsel|analyst/i },
  { name: "enterprise sales AE", dir: "Target role: Enterprise Account Executive. Close large SaaS deals, own a revenue number, build relationships with executive buyers.", want: /sales|account executive|account manager|revenue|business development|partnerships|gtm/i, avoid: /software engineer|infrastructure|scientist/i },
  { name: "product marketer", dir: "Target role: Product Marketing Lead. Positioning, messaging, go-to-market campaigns, and brand storytelling.", want: /marketing|brand|content|communications|community|product manager|product partnerships/i, avoid: /software engineer|infrastructure|counsel/i },
  { name: "data scientist", dir: "Target role: Senior Data Scientist. Build ML models, run experiments, turn data into product and business insight.", want: /data|scientist|machine learning|\bml\b|analytics|research|analyst/i, avoid: /account executive|counsel|recruiter/i },
];

async function main() {
  const { db } = await import("../src/db");
  const { opportunities } = await import("../src/db/schema");
  const { and, isNotNull, ne } = await import("drizzle-orm");
  const { embed, cosine, trajectoryFromCosine, EMBED_CALIBRATION } = await import("../src/lib/embeddings");

  const roles = await db
    .select({ title: opportunities.title, company: opportunities.company, embedding: opportunities.embedding })
    .from(opportunities)
    .where(and(isNotNull(opportunities.embedding), ne(opportunities.source, "sample")));
  const withEmb = roles.filter((r) => (r.embedding as number[] | null)?.length);
  console.log(`scoring ${ARCH.length} directions against ${withEmb.length} embedded roles`);
  console.log(`calibration in use: LO=${EMBED_CALIBRATION.COS_LO} HI=${EMBED_CALIBRATION.COS_HI}\n${"=".repeat(80)}`);

  const dvecs = await embed(ARCH.map((a) => `search_query: ${a.dir}`));
  const allCos: number[] = [];
  let fails = 0;

  ARCH.forEach((a, ai) => {
    const scored = withEmb
      .map((r) => ({ title: r.title ?? "?", company: r.company ?? "?", cos: cosine(dvecs[ai], r.embedding as number[]) }))
      .sort((x, y) => y.cos - x.cos);
    allCos.push(...scored.map((s) => s.cos));
    const top8 = scored.slice(0, 8);
    const wantHits = top8.filter((t) => a.want.test(t.title)).length;
    const avoidTop3 = scored.slice(0, 3).filter((t) => a.avoid.test(t.title));
    const pass = wantHits >= 5 && avoidTop3.length === 0;
    if (!pass) fails++;
    console.log(`\n■ ${a.name}  ${pass ? "✅" : "❌"}  (${wantHits}/8 on-direction in top-8, ${avoidTop3.length} wrong-discipline in top-3)`);
    for (const t of top8) console.log(`   ${t.cos.toFixed(3)} → traj ${trajectoryFromCosine(t.cos).toFixed(2)}  ${t.title.slice(0, 52)}`);
    console.log(`   … bottom: ${scored.slice(-2).map((s) => `${s.cos.toFixed(3)} ${s.title.slice(0, 24)}`).join(" | ")}`);
  });

  allCos.sort((a, b) => a - b);
  const q = (p: number) => allCos[Math.floor(p * (allCos.length - 1))].toFixed(3);
  console.log(`\n${"=".repeat(80)}\nCOSINE DISTRIBUTION (all direction×role pairs):`);
  console.log(`  min ${q(0)}  p10 ${q(0.1)}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  p90 ${q(0.9)}  p97 ${q(0.97)}  max ${q(1)}`);
  console.log(`  → suggested LO≈p25 (${q(0.25)}), HI≈p97 (${q(0.97)}); current LO=${EMBED_CALIBRATION.COS_LO} HI=${EMBED_CALIBRATION.COS_HI}`);
  console.log(`\n${fails === 0 ? "✅ ALL DIRECTIONS PASS — embedding trajectory is sane, lock it in" : `❌ ${fails}/${ARCH.length} failed`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
