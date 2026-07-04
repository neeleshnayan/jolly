/**
 * POST /api/profile/batch — apply a batch of field edits in one transaction.
 * { userId, edits: [{ kind, id?, patch }] }. This is what the editor's debounced
 * autosave flushes, so a flurry of edits becomes one request + one source row.
 * Also handles navigator.sendBeacon on page-leave (JSON body).
 */
import { NextResponse } from "next/server";
import { applyEdits, type EditKind } from "@/lib/profile/update";

export const runtime = "nodejs";

const KINDS: EditKind[] = ["profile", "experience", "education", "skill", "project"];

export async function POST(req: Request) {
  try {
    const { userId, edits } = (await req.json()) ?? {};
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      return NextResponse.json({ error: "No edits" }, { status: 400 });
    }
    for (const e of edits) {
      if (!KINDS.includes(e?.kind)) {
        return NextResponse.json({ error: `Invalid kind: ${e?.kind}` }, { status: 400 });
      }
    }
    const result = await applyEdits(userId, edits);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/profile/batch]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
