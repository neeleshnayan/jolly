import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, experiences, education, skills, projects } from "@/db/schema";

/** Full Layer 2 for a user — what the resume template renders. */
export async function getFullProfile(userId: string) {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!profile) return null;

  const pid = profile.id;
  const [exps, edu, sk, proj] = await Promise.all([
    db.select().from(experiences).where(eq(experiences.profileId, pid)),
    db.select().from(education).where(eq(education.profileId, pid)),
    db.select().from(skills).where(eq(skills.profileId, pid)),
    db.select().from(projects).where(eq(projects.profileId, pid)),
  ]);

  return { profile, experiences: exps, education: edu, skills: sk, projects: proj };
}
