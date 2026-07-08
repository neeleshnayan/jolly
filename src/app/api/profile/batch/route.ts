/**
 * POST /api/profile/batch — apply a batch of field edits in one transaction.
 * { userId, edits: [{ kind, id?, patch }] }. This is what the editor's debounced
 * autosave flushes, so a flurry of edits becomes one request + one source row.
 * Also handles navigator.sendBeacon on page-leave (JSON body).
 */
import { NextResponse } from "next/server";
import { applyEdits, type EditKind } from "@/lib/profile/update";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

const KINDS: EditKind[] = ["profile", "experience", "education", "skill", "project", "certification"];

export async function POST(req: Request) {
  try {
    const body = (await req.json()) ?? {};
    const { edits } = body;
    // session-first — a body userId is only honored in development (covers
    // sendBeacon too: the session cookie rides along with same-origin beacons)
    const userId = await resolveUserId(body.userId);
    if (!userId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
