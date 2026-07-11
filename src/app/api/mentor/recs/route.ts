/**
 * GET /api/mentor/recs?direction=marketing — real, current roles that fit the
 * signed-in user in a given direction. Backs the Deepgram `fetch_recommendations`
 * function call so the agent grounds the conversation in actual openings.
 */
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { recsForDirection } from "@/lib/opportunities/direction";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await resolveUserId(null);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const direction = new URL(req.url).searchParams.get("direction") ?? "";
  try {
    const roles = await recsForDirection(userId, direction);
    return NextResponse.json({ ok: true, roles });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed", roles: [] }, { status: 500 });
  }
}
