/**
 * GET /api/opportunities/matches?u=<userId> — roles ranked for this user, with a
 * per-role "why", plus a 3-role spectrum to open a mentor call with. Uses the
 * cached scoring vector, so it's cheap to poll from the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { rankMatchesWithMeta, pickSpectrum } from "@/lib/opportunities/recommend";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { matches, learning } = await rankMatchesWithMeta(userId);
  const spectrum = pickSpectrum(matches);
  return NextResponse.json({ ok: true, count: matches.length, matches, spectrum, learning });
}
