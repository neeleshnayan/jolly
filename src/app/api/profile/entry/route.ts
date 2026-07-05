/**
 * POST /api/profile/entry — add or remove a résumé entry.
 * { userId, kind, action: "create" | "delete", id? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createEntry, deleteEntry, type EntryKind } from "@/lib/profile/update";

export const runtime = "nodejs";

const KINDS: EntryKind[] = ["experience", "education", "skill", "project", "certification"];

export async function POST(req: NextRequest) {
  try {
    const { userId, kind, action, id } = (await req.json()) ?? {};
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (action === "create") {
      return NextResponse.json(await createEntry(userId, kind));
    }
    if (action === "delete") {
      if (typeof id !== "string" || !id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
      }
      return NextResponse.json(await deleteEntry(userId, kind, id));
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[/api/profile/entry]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
