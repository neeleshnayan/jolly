/**
 * POST /api/resume/refine — the point-and-ask refiner.
 * { instruction, bullets: string[], role? } → { bullets: string[] }
 * Returns a proposed rewrite; the client shows it for accept/reject. Nothing is
 * persisted here — approval happens in the editor's normal save path.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { bulletRefiner } from "@/agents/bullet-refiner";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { instruction, bullets, role, userId: suppliedUserId } = await req.json().catch(() => ({}));
    // no writes, but it burns local GPU — signed-in users only
    const userId = await resolveUserId(typeof suppliedUserId === "string" ? suppliedUserId : null);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof instruction !== "string" || !instruction.trim()) {
      return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
    }
    if (!Array.isArray(bullets) || bullets.length === 0) {
      return NextResponse.json({ error: "Nothing to refine" }, { status: 400 });
    }
    const { output } = await runAgent(
      bulletRefiner,
      {
        instruction: instruction.trim(),
        bullets: bullets.filter((b) => typeof b === "string" && b.trim()),
        role: typeof role === "string" ? role : undefined,
      },
      { userId },
    );
    return NextResponse.json({ ok: true, bullets: output.bullets });
  } catch (err) {
    console.error("[/api/resume/refine]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
