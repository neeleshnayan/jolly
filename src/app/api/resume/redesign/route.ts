/**
 * POST /api/resume/redesign — the whole-sheet "re-paint" endpoint.
 * { userId } → { styleConfig, rationale }. Reads the résumé, asks the designer
 * agent for a set of style tokens, and returns them for the client to preview
 * and accept. Content is never modified here — only the look.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { resumeRedesigner } from "@/agents/resume-redesigner";
import { getFullProfile } from "@/lib/profile/read";
import { buildProfileText } from "@/lib/scoring/profileText";
import { toStyleConfig } from "@/lib/redesign/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { userId } = await req.json().catch(() => ({}));
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    const full = await getFullProfile(userId);
    if (!full) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const profileText = buildProfileText(full, []);
    // no DOM on the server — estimate page count from content length
    const pages = Math.max(1, Math.round(profileText.length / 2600));

    const { output } = await runAgent(resumeRedesigner, { profileText, pages }, { userId });
    return NextResponse.json({
      ok: true,
      styleConfig: toStyleConfig(output),
      rationale: output.rationale,
    });
  } catch (err) {
    console.error("[/api/resume/redesign]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
