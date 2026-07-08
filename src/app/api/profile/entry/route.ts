/**
 * POST /api/profile/entry — add or remove a résumé entry.
 * { userId, kind, action: "create" | "delete", id? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createEntry, deleteEntry, type EntryKind } from "@/lib/profile/update";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

const KINDS: EntryKind[] = ["experience", "education", "skill", "project", "certification"];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) ?? {};
    const { kind, action, id } = body;
    const userId = await resolveUserId(body.userId); // session-first
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
