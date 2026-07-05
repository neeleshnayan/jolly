/**
 * Map a LinkedIn identity to one of our profiles. First login creates a profile
 * (new stable userId) pre-filled with the identity LinkedIn gives us; later
 * logins find it by `linkedinSub` and refresh the avatar. Returns the app's
 * userId (profiles.userId) to put in the session.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { LinkedInUser } from "./linkedin";

export async function upsertLinkedInUser(u: LinkedInUser): Promise<string> {
  const [existing] = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.linkedinSub, u.sub))
    .limit(1);

  if (existing) {
    // refresh avatar only — never clobber name/email the user may have edited
    await db
      .update(profiles)
      .set({ avatarUrl: u.picture ?? null, updatedAt: new Date() })
      .where(eq(profiles.linkedinSub, u.sub));
    return existing.userId;
  }

  const userId = crypto.randomUUID();
  await db.insert(profiles).values({
    userId,
    linkedinSub: u.sub,
    fullName: u.name ?? null,
    email: u.email ?? null,
    avatarUrl: u.picture ?? null,
  });
  return userId;
}
