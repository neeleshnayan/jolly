import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, experiences, insights } from "@/db/schema";

export interface MentorMap {
  profile: { fullName: string | null; headline: string | null } | null;
  experiences: { title: string | null; org: string | null }[];
  insights: { dimension: string; content: string; confidence: number | null }[];
}

/** The slice of the map the mentor needs to probe intelligently. */
export async function getMentorMap(userId: string): Promise<MentorMap> {
  const [profile] = await db
    .select({ id: profiles.id, fullName: profiles.fullName, headline: profiles.headline })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) return { profile: null, experiences: [], insights: [] };

  const [exps, ins] = await Promise.all([
    db
      .select({ title: experiences.title, org: experiences.org })
      .from(experiences)
      .where(eq(experiences.profileId, profile.id)),
    db
      .select({
        dimension: insights.dimension,
        content: insights.content,
        confidence: insights.confidence,
      })
      .from(insights)
      .where(and(eq(insights.profileId, profile.id), eq(insights.status, "active"))),
  ]);

  return {
    profile: { fullName: profile.fullName, headline: profile.headline },
    experiences: exps,
    insights: ins,
  };
}
