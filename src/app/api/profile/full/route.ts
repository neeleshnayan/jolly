/**
 * GET /api/profile/full?u=<userId> — the full editable profile, for the client
 * to refresh in place after a version restore (no full page reload).
 */
import { NextRequest, NextResponse } from "next/server";
import { getFullProfile } from "@/lib/profile/read";
import { getSessionUserId } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = (await getSessionUserId()) ?? req.nextUrl.searchParams.get("u");
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const data = await getFullProfile(userId);
  if (!data) return NextResponse.json({ error: "No profile" }, { status: 404 });
  return NextResponse.json(data);
}
