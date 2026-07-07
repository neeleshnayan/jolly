/**
 * GET  /api/preferences?u=<userId>  — read the user's matching refinements
 * POST /api/preferences             — save them (comp targets + location/remote)
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { getPreferences, savePreferences, type Preferences } from "@/lib/preferences";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ ok: true, preferences: await getPreferences(userId) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; preferences?: Preferences };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const saved = await savePreferences(userId, body.preferences ?? {});
  return NextResponse.json({ ok: true, preferences: saved });
}
