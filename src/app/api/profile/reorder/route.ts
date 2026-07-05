/**
 * POST /api/profile/reorder — persist a section's new entry order.
 * { userId, kind, ids: [orderedEntryIds] }
 */
import { NextResponse } from "next/server";
import { reorderEntries, type EntryKind } from "@/lib/profile/update";

export const runtime = "nodejs";

const KINDS: EntryKind[] = ["experience", "education", "skill", "project", "certification"];

export async function POST(req: Request) {
  try {
    const { userId, kind, ids } = (await req.json()) ?? {};
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
    }
    return NextResponse.json(await reorderEntries(userId, kind, ids));
  } catch (err) {
    console.error("[/api/profile/reorder]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
