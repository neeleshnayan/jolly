/**
 * GET /api/opportunities/matches?u=<userId> — roles ranked for this user, with a
 * per-role "why", plus a 3-role spectrum to open a mentor call with. Uses the
 * cached scoring vector, so it's cheap to poll from the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { rankMatches, pickSpectrum } from "@/lib/opportunities/recommend";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const ranked = await rankMatches(userId);
  const spectrum = pickSpectrum(ranked);
  return NextResponse.json({ ok: true, count: ranked.length, matches: ranked, spectrum });
}
