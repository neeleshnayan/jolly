import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { createTheme, listThemes } from "@/lib/track/persist";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url).searchParams.get("u");
    const userId = (await getSessionUserId()) ?? u;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ themes: await listThemes(userId) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = (await getSessionUserId()) ?? body.userId;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Theme name required" }, { status: 400 });
    }
    const theme = await createTheme(userId, body.name.trim());
    return NextResponse.json({ ok: true, theme });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
