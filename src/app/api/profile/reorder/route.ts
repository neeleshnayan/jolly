/**
 * POST /api/profile/reorder — persist a section's new entry order.
 * { userId, kind, ids: [orderedEntryIds] }
 */
import { NextResponse } from "next/server";
import { reorderEntries, type EntryKind } from "@/lib/profile/update";
import { resolveUserId } from "@/lib/auth/user";
import { invalidateScoring } from "@/lib/scoring/persist";

export const runtime = "nodejs";

const KINDS: EntryKind[] = ["experience", "education", "skill", "project", "certification"];

export async function POST(req: Request) {
  try {
    const body = (await req.json()) ?? {};
    const { kind, ids } = body;
    const userId = await resolveUserId(body.userId); // session-first
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!Array.isArray(ids)) {
      return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
    }
    const res = await reorderEntries(userId, kind, ids);
    void invalidateScoring(userId); // order shapes emphasis the scorer reads
    return NextResponse.json(res);
  } catch (err) {
    console.error("[/api/profile/reorder]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
