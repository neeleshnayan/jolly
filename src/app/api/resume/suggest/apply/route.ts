import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { resumeSuggestions } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";
import { applySuggestion } from "@/lib/suggest/apply";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (body.kind !== "bullet" && body.kind !== "skill") {
      return NextResponse.json({ error: "Bad suggestion" }, { status: 400 });
    }
    await applySuggestion(userId, {
      kind: body.kind,
      entryKind: body.entryKind === "project" ? "project" : body.entryKind === "experience" ? "experience" : undefined,
      entryId: typeof body.entryId === "string" ? body.entryId : undefined,
      text: String(body.text ?? "").trim(),
    });
    // mark the stored tip applied so it doesn't resurface next visit
    if (typeof body.suggestionId === "string") {
      try {
        await db.update(resumeSuggestions).set({ status: "applied" }).where(eq(resumeSuggestions.id, body.suggestionId));
      } catch {
        /* best-effort bookkeeping */
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
