import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";

/** Find-or-create the user's profile, returning its id. */
export async function ensureProfile(userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(profiles)
    .values({ userId })
    .returning({ id: profiles.id });
  return created.id;
}
