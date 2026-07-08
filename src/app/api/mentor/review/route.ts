/**
 * POST /api/mentor/review — commit the user-approved insights to the map.
 * This is the ONLY path that writes mentor-call insights: the user has seen the
 * recap, corrected what was wrong, and tapped save. Insights are validated
 * (dimension enum, confidence range) before they touch Layer 3.
 */
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { persistInsights } from "@/lib/insights/persist";
import { extractedInsight } from "@/lib/insights/schema";
import { computeAndSaveScoring } from "@/lib/scoring/persist";
import { runAgent } from "@/agents/run";
import { targetRoleRecommender } from "@/agents/target-role";
import { fillTargetTheme } from "@/lib/track/persist";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

const bodySchema = z.object({
  userId: z.string().min(1).optional(),
  transcript: z.string().default(""),
  insights: z.array(extractedInsight).default([]),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.parse(await req.json());
    const { transcript, insights } = parsed;
    // session-first — this route WRITES to the insight map; a raw body userId
    // must never pick whose map in production
    const userId = await resolveUserId(parsed.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const result = await persistInsights({
      userId,
      extraction: { insights },
      transcript,
    });
    // in the background: refresh the cached scoring AND fill the TBD target-role
    // theme from what the call revealed. Sequential (shared local GPU).
    after(async () => {
      try {
        await computeAndSaveScoring(userId);
      } catch (err) {
        console.warn("[/api/mentor/review] scoring refresh failed", err);
      }
      try {
        const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
        if (full) {
          const profileText = buildProfileText(full, map.insights);
          const { output } = await runAgent(targetRoleRecommender, { profileText }, { userId });
          await fillTargetTheme(userId, output.role, output.rationale);
        }
      } catch (err) {
        console.warn("[/api/mentor/review] target-role fill failed", err);
      }
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/mentor/review]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
