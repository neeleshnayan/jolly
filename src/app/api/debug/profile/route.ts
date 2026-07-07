/**
 * GET /api/debug/profile?u=<userId> — a debugging surface. Returns the person's
 * insights, the open probes, and the scoring vector. Scoring is cached on the
 * profile and served as-is; pass ?recompute=1 to force a fresh run.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMentorMap } from "@/lib/profile/map";
import { resolveUserId } from "@/lib/auth/user";
import { computeAndSaveScoring, getSavedScoring } from "@/lib/scoring/persist";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  // debug surface: invisible in production except to the admin
  if (process.env.NODE_ENV === "production" && !(await requireAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const map = await getMentorMap(userId);
  if (!map.profile) return NextResponse.json({ error: "No profile for this user" }, { status: 404 });

  // Serve the cached scoring vector; compute only when asked, or the first time
  // there's nothing cached yet.
  const recompute = req.nextUrl.searchParams.get("recompute") === "1";
  let scoring: unknown = null;
  let scoringAt: string | null = null;
  let scoringError: string | null = null;
  try {
    if (recompute) {
      scoring = await computeAndSaveScoring(userId);
      scoringAt = new Date().toISOString();
    } else {
      const saved = await getSavedScoring(userId);
      if (saved.scoring) {
        scoring = saved.scoring;
        scoringAt = saved.scoringAt?.toISOString() ?? null;
      } else {
        scoring = await computeAndSaveScoring(userId);
        scoringAt = new Date().toISOString();
      }
    }
  } catch (err) {
    scoringError = err instanceof Error ? err.message : "scoring failed";
  }

  return NextResponse.json({
    ok: true,
    profile: { fullName: map.profile?.fullName, headline: map.profile?.headline },
    insights: map.insights,
    probes: map.probes,
    scoring,
    scoringAt,
    scoringError,
  });
}
