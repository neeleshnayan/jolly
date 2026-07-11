/**
 * GET /api/opportunities/matches?u=<userId> — roles ranked for this user, with a
 * per-role "why", plus a 3-role spectrum to open a mentor call with. Serves the
 * cached scoring vector, so it's cheap to poll. If the vector is stale (edited
 * since), the recompute runs in the BACKGROUND and this returns the cached
 * ranking instantly — reads never block on the big-model pass. Pass ?refresh=1
 * (the explicit Refresh button) to wait for the fresh ranking.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { rankMatchesWithMeta, pickSpectrum, type RankedJob, type RankOutcome } from "@/lib/opportunities/recommend";
import { TRUSTED_MODELS } from "@/lib/jobs/vectorize";
import { canonSkillKey } from "@/lib/skills/canon";
import { getLearnedSkillCasing, displaySkillSmart } from "@/lib/skills/learned";

/**
 * On Cloudflare the ranking blend runs in the Supabase Edge Function `rank`
 * (where the data lives) — the Worker (free plan, 10ms CPU) can't score hundreds
 * of roles. This is ONE fetch, near-zero Worker CPU. On Node we rank locally.
 * See docs/adr-001-ranking-funnel.md.
 */
async function rankViaEdge(userId: string): Promise<RankOutcome> {
  const url = process.env.RANK_FN_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("RANK_FN_URL / SUPABASE_ANON_KEY not configured");
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ userId, trusted: TRUSTED_MODELS }),
  });
  if (!r.ok) throw new Error(`rank fn ${r.status}`);
  const out = (await r.json()) as RankOutcome;
  return { matches: out.matches ?? [], learning: out.learning ?? { active: false, events: 0, confidence: 0 }, userSkillKeys: out.userSkillKeys ?? [] };
}

export const runtime = "nodejs";
export const maxDuration = 90;

/** `key` is the canonical lowercase identity (matching/filtering); `skill` is
 *  the résumé-ready display form. Never show the key; never match the label. */
export type SkillRadarEntry = { key: string; skill: string; demand: number; have: boolean; avgFit: number };

/** The skills-overlap lens: across the roles that ALIGN with this user, which
 *  skills does the market keep asking for — and which are missing from their
 *  résumé? Demand-ranked, so a missing skill becomes an actionable ("18 of
 *  your aligned roles want Kubernetes"), not a vague to-do. Aggregated by
 *  CANONICAL key so "TypeScript"/"typescript"/"ts" from different extraction
 *  models tally as one skill, displayed in résumé casing. */
function skillRadar(matches: RankedJob[], userSkills: string[], learned: Map<string, string>): SkillRadarEntry[] {
  const mine = userSkills.map(canonSkillKey).filter(Boolean);
  const haveSkill = (s: string) => mine.some((m) => m === s || m.includes(s) || s.includes(m));
  const tally = new Map<string, { demand: number; fitSum: number }>();
  for (const m of matches.slice(0, 60)) {
    // a role may list casing/alias variants of one skill; count each key once per role
    const keys = new Set(m.skills.map(canonSkillKey).filter((k) => k.length >= 2 && k.length <= 40));
    for (const k of keys) {
      const t = tally.get(k) ?? { demand: 0, fitSum: 0 };
      t.demand += 1;
      t.fitSum += m.fit;
      tally.set(k, t);
    }
  }
  return [...tally.entries()]
    .filter(([, t]) => t.demand >= 2) // one-off mentions aren't a signal
    .map(([key, t]) => ({ key, skill: displaySkillSmart(key, learned), demand: t.demand, have: haveSkill(key), avgFit: t.fitSum / t.demand }))
    .sort((a, b) => b.demand - a.demand || b.avgFit - a.avgFit)
    .slice(0, 16);
}

export async function GET(req: NextRequest) {
  // progress marks: `wrangler tail` shows exactly where a failing request dies
  const t0 = Date.now();
  const mark = (s: string) => console.log(`[matches] ${s} +${Date.now() - t0}ms`);
  mark("start");
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  mark("auth");
  const wait = req.nextUrl.searchParams.get("refresh") === "1";
  const onCF = process.env.DEPLOY_TARGET === "cloudflare";
  const { matches, learning, userSkillKeys } = onCF
    ? await rankViaEdge(userId)
    : await rankMatchesWithMeta(userId, { wait });
  mark(`ranked ${matches.length}`);
  // diagnostic: same RPC + ranking, near-zero response payload — separates
  // "DB call fails" from "response construction/size fails" on Workers
  if (req.nextUrl.searchParams.get("lite") === "1") {
    return NextResponse.json({ ok: true, count: matches.length, top: matches.slice(0, 3).map((m) => m.title) });
  }
  const spectrum = pickSpectrum(matches);
  // userSkillKeys rides along from the ranking RPC — zero extra DB round-trips
  // here. Learned casing is skipped on CF (its pool-wide scan is Node-cached;
  // cosmetic only — canon + title-case fallback still applies).
  const learned = process.env.DEPLOY_TARGET === "cloudflare" ? new Map<string, string>() : await getLearnedSkillCasing();
  mark("casing");
  const radar = skillRadar(matches, userSkillKeys, learned);
  mark("done");
  return NextResponse.json({ ok: true, count: matches.length, matches, spectrum, learning, skillRadar: radar });
}
