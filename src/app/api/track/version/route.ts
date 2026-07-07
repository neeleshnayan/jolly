import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { createVersion, getThemesWithVersions } from "@/lib/track/persist";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url).searchParams.get("u");
    const userId = await resolveUserId(u);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.json(await getThemesWithVersions(userId));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const version = await createVersion(userId, {
      themeId: typeof body.themeId === "string" ? body.themeId : undefined,
      hypothesis: typeof body.hypothesis === "string" ? body.hypothesis : undefined,
      label: typeof body.label === "string" ? body.label : undefined,
    });
    return NextResponse.json({ ok: true, version });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
