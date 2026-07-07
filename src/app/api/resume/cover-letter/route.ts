/**
 * POST /api/resume/cover-letter — { jd? } → { letter, hooks }.
 * Built from the profile + the mentor's insights; tailored to the JD if given.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { coverLetterWriter } from "@/agents/cover-letter";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { getSessionUserId } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { userId?: string; jd?: string };
    const userId = (await getSessionUserId()) ?? body.userId;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
    if (!full) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const profileText = buildProfileText(full, map.insights);
    const jd = typeof body.jd === "string" ? body.jd.slice(0, 12000) : undefined;
    const { output } = await runAgent(coverLetterWriter, { profileText, jd }, { userId });

    // local models sneak markdown emphasis into prose — a letter is plain text
    const letter = output.letter.replace(/\*\*?([^*\n]+)\*\*?/g, "$1").replace(/__([^_\n]+)__/g, "$1");
    return NextResponse.json({ ok: true, letter, hooks: output.hooks });
  } catch (err) {
    console.error("[/api/resume/cover-letter]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
