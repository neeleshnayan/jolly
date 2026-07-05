import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { setActiveVersion } from "@/lib/track/persist";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = (await getSessionUserId()) ?? body.userId;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof body.themeId !== "string" || typeof body.versionId !== "string") {
      return NextResponse.json({ error: "themeId and versionId required" }, { status: 400 });
    }
    await setActiveVersion(userId, body.themeId, body.versionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
