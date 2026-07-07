import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { restoreVersion } from "@/lib/track/persist";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof body.versionId !== "string") {
      return NextResponse.json({ error: "versionId required" }, { status: 400 });
    }
    await restoreVersion(userId, body.versionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
