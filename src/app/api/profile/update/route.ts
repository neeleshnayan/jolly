import { NextRequest, NextResponse } from "next/server";
import { applyEdit, type EditKind } from "@/lib/profile/update";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

const KINDS: EditKind[] = ["profile", "experience", "education", "skill", "project", "certification"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { kind, id, patch } = body ?? {};
    // session-first — a body userId is only honored in development
    const userId = await resolveUserId(body?.userId);
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }

    const result = await applyEdit({ userId, kind, id, patch });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/profile/update]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
