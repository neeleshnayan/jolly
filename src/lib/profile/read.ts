import { asc, eq } from "drizzle-orm";
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
    db.select().from(experiences).where(eq(experiences.profileId, pid)).orderBy(asc(experiences.position), asc(experiences.createdAt)),
    db.select().from(education).where(eq(education.profileId, pid)).orderBy(asc(education.position), asc(education.createdAt)),
    db.select().from(skills).where(eq(skills.profileId, pid)).orderBy(asc(skills.position), asc(skills.createdAt)),
    db.select().from(projects).where(eq(projects.profileId, pid)).orderBy(asc(projects.position), asc(projects.createdAt)),
  ]);

  return { profile, experiences: exps, education: edu, skills: sk, projects: proj };
}
