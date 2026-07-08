/**
 * GET /api/opportunities/matches?u=<userId> — roles ranked for this user, with a
 * per-role "why", plus a 3-role spectrum to open a mentor call with. Uses the
 * cached scoring vector, so it's cheap to poll from the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, skills } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";
import { rankMatchesWithMeta, pickSpectrum, type RankedJob } from "@/lib/opportunities/recommend";

export const runtime = "nodejs";
export const maxDuration = 90;

export type SkillRadarEntry = { skill: string; demand: number; have: boolean; avgFit: number };

/** The skills-overlap lens: across the roles that ALIGN with this user, which
 *  skills does the market keep asking for — and which are missing from their
 *  résumé? Demand-ranked, so a missing skill becomes an actionable ("18 of
 *  your aligned roles want kubernetes"), not a vague to-do. */
function skillRadar(matches: RankedJob[], userSkills: string[]): SkillRadarEntry[] {
  const mine = userSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const haveSkill = (s: string) => mine.some((m) => m === s || m.includes(s) || s.includes(m));
  const tally = new Map<string, { demand: number; fitSum: number }>();
  for (const m of matches.slice(0, 60)) {
    for (const s of m.skills) {
      if (s.length < 2 || s.length > 40) continue;
      const t = tally.get(s) ?? { demand: 0, fitSum: 0 };
      t.demand += 1;
      t.fitSum += m.fit;
      tally.set(s, t);
    }
  }
  return [...tally.entries()]
    .filter(([, t]) => t.demand >= 2) // one-off mentions aren't a signal
    .map(([skill, t]) => ({ skill, demand: t.demand, have: haveSkill(skill), avgFit: t.fitSum / t.demand }))
    .sort((a, b) => b.demand - a.demand || b.avgFit - a.avgFit)
    .slice(0, 16);
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { matches, learning } = await rankMatchesWithMeta(userId);
  const spectrum = pickSpectrum(matches);
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const mySkills = p ? await db.select({ name: skills.name }).from(skills).where(eq(skills.profileId, p.id)) : [];
  const radar = skillRadar(matches, mySkills.map((s) => s.name ?? ""));
  return NextResponse.json({ ok: true, count: matches.length, matches, spectrum, learning, skillRadar: radar });
}
