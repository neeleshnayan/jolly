/**
 * GET /api/opportunities/matches?u=<userId> — rank every stored role for a user.
 * Scores the candidate once, then matches against each opportunity's vector and
 * returns them fit-ranked with per-role reasons/gaps. (Hard filters — comp floor,
 * location — slot in here later, once we capture the user's constraints.)
 */
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { runAgent } from "@/agents/run";
import { profileScorer } from "@/agents/profile-scorer";
import { scoreMatch } from "@/lib/opportunities/match";
import type { OpportunityVector } from "@/lib/opportunities/schema";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("u");
  if (!userId) return NextResponse.json({ error: "Missing ?u=<userId>" }, { status: 400 });

  const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
  if (!full) return NextResponse.json({ error: "No profile for this user" }, { status: 404 });

  const { output: userVector } = await runAgent(
    profileScorer,
    { profileText: buildProfileText(full, map.insights) },
    { userId },
  );

  const roles = await db
    .select()
    .from(opportunities)
    .orderBy(desc(opportunities.createdAt))
    .limit(100);

  const ranked = roles
    .map((r) => {
      const match = scoreMatch(userVector, (r.vector ?? {}) as OpportunityVector);
      return {
        id: r.id,
        title: r.title,
        company: r.company,
        location: r.location,
        remote: r.remote,
        compMin: r.compMin,
        compMax: r.compMax,
        stage: r.companyStage,
        url: r.url,
        fit: match.fit,
        qualification: match.qualification,
        desire: match.desire,
        reasons: match.reasons,
        gaps: match.gaps,
      };
    })
    .sort((a, b) => b.fit - a.fit);

  return NextResponse.json({ ok: true, count: ranked.length, matches: ranked });
}
