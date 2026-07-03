import { NextRequest, NextResponse } from "next/server";
import { applyEdit, type EditKind } from "@/lib/profile/update";

export const runtime = "nodejs";

const KINDS: EditKind[] = ["profile", "experience", "education", "skill", "project"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, kind, id, patch } = body ?? {};

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
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
