import { NextRequest, NextResponse } from "next/server";
import { getFullProfile } from "@/lib/profile/read";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // the FULL résumé (email, phone, everything) — session-first, always
  const userId = await resolveUserId(req.nextUrl.searchParams.get("userId"));
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const data = await getFullProfile(userId);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
