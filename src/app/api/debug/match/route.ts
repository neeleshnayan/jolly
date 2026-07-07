/**
 * POST /api/debug/match  { userId, jd } — end-to-end matching test.
 * Computes the candidate's scoring vector and the role's opportunity vector,
 * then scores the fit. Two LLM passes; a test surface, not production.
 */
import { NextResponse } from "next/server";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { runAgent } from "@/agents/run";
import { profileScorer } from "@/agents/profile-scorer";
import { opportunityVectorizer } from "@/agents/opportunity-vectorizer";
import { scoreMatch } from "@/lib/opportunities/match";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  // debug surface: invisible in production except to the admin
  if (process.env.NODE_ENV === "production" && !(await requireAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const { userId, jd } = await req.json().catch(() => ({}));
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (typeof jd !== "string" || jd.trim().length < 40) {
      return NextResponse.json({ error: "Paste a fuller job description (jd)" }, { status: 400 });
    }

    const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
    if (!full) return NextResponse.json({ error: "No profile for this user" }, { status: 404 });

    // score the candidate, then vectorize the role (sequential — one big model)
    const { output: userVector } = await runAgent(
      profileScorer,
      { profileText: buildProfileText(full, map.insights) },
      { userId },
    );
    const { output: role } = await runAgent(opportunityVectorizer, { jd }, { userId });

    const match = scoreMatch(userVector, role.vector);

    return NextResponse.json({
      ok: true,
      role: role.facts,
      match,
    });
  } catch (err) {
    console.error("[/api/debug/match]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
