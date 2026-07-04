/**
 * GET /api/debug/profile?u=<userId> — a debugging surface. Returns the person's
 * insights, the open probes, and a freshly-computed scoring vector so we can see
 * how the extraction is tying out. Scoring runs on demand (not persisted yet) —
 * this is the iterate-against-live-users view, not a production endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { runAgent } from "@/agents/run";
import { profileScorer } from "@/agents/profile-scorer";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("u");
  if (!userId) return NextResponse.json({ error: "Missing ?u=<userId>" }, { status: 400 });

  const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
  if (!full) return NextResponse.json({ error: "No profile for this user" }, { status: 404 });

  const profileText = buildProfileText(full, map.insights);

  let scoring: unknown = null;
  let scoringError: string | null = null;
  try {
    const { output } = await runAgent(profileScorer, { profileText }, { userId });
    scoring = output;
  } catch (err) {
    scoringError = err instanceof Error ? err.message : "scoring failed";
  }

  return NextResponse.json({
    ok: true,
    profile: { fullName: map.profile?.fullName, headline: map.profile?.headline },
    insights: map.insights,
    probes: map.probes,
    scoring,
    scoringError,
  });
}
