/**
 * The scoring vector is expensive (big model), so it's cached on the profile and
 * only refreshed when the inputs change — after an upload, after a mentor call,
 * or on explicit request. Read paths serve the saved value.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, scoringSnapshots } from "@/db/schema";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { runAgent } from "@/agents/run";
import { profileScorer } from "@/agents/profile-scorer";

/** Recompute the scoring vector and cache it on the profile. Returns the vector. */
export async function computeAndSaveScoring(userId: string): Promise<Record<string, unknown>> {
  const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
  if (!full) throw new Error("No profile for this user");
  const profileText = buildProfileText(full, map.insights);
  const { output } = await runAgent(profileScorer, { profileText }, { userId });
  const scoring = output as Record<string, unknown>;
  await db.update(profiles).set({ scoring, scoringAt: new Date() }).where(eq(profiles.userId, userId));
  // history, never overwritten — powers "how the mentor's read of you evolved"
  try {
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (p) await db.insert(scoringSnapshots).values({ profileId: p.id, vector: scoring });
  } catch {
    /* history is best-effort; the hot cache above is what matters */
  }
  return scoring;
}

export async function getSavedScoring(
  userId: string,
): Promise<{ scoring: Record<string, unknown> | null; scoringAt: Date | null }> {
  const [p] = await db
    .select({ scoring: profiles.scoring, scoringAt: profiles.scoringAt })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return { scoring: p?.scoring ?? null, scoringAt: p?.scoringAt ?? null };
}
