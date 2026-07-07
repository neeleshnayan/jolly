/**
 * Map a LinkedIn identity to one of our profiles. Resolution order:
 *   1. linkedinSub  — they've logged in before
 *   2. email        — they used the app BEFORE logging in (anonymous upload
 *                     extracted their email); CLAIM that profile rather than
 *                     minting a duplicate. This was the phantom-profile bug:
 *                     upload-then-login produced two profiles per human.
 *   3. create       — genuinely new
 * Returns the app's userId (profiles.userId) to put in the session.
 */
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import type { LinkedInUser } from "./linkedin";

export async function upsertLinkedInUser(u: LinkedInUser): Promise<string> {
  const [bySub] = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.linkedinSub, u.sub))
    .limit(1);
  if (bySub) {
    // refresh avatar only — never clobber name/email the user may have edited
    await db
      .update(profiles)
      .set({ avatarUrl: u.picture ?? null, updatedAt: new Date() })
      .where(eq(profiles.linkedinSub, u.sub));
    return bySub.userId;
  }

  if (u.email) {
    const [byEmail] = await db
      .select({ userId: profiles.userId, id: profiles.id })
      .from(profiles)
      .where(sql`lower(${profiles.email}) = ${u.email.toLowerCase()}`)
      .limit(1);
    if (byEmail) {
      await db
        .update(profiles)
        .set({
          linkedinSub: u.sub,
          avatarUrl: u.picture ?? null,
          fullName: sql`coalesce(${profiles.fullName}, ${u.name ?? null})`,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, byEmail.id));
      return byEmail.userId;
    }
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
