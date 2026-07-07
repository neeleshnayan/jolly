/**
 * Gate for the admin-only control dashboard (/admin). Just an allowlist of
 * profile emails in ADMIN_EMAILS — no separate role system needed for one
 * operator. Checked against the signed-in session's profile, not the request.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSessionUserId } from "./session";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Returns the admin's userId if the current session belongs to an allowed
 *  email, else null. Use to gate both pages and API routes. */
export async function requireAdmin(): Promise<string | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const allowed = adminEmails();
  if (!allowed.length) return null; // no admins configured — fail closed
  const [p] = await db.select({ email: profiles.email }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const email = p?.email?.toLowerCase();
  if (!email || !allowed.includes(email)) return null;
  return userId;
}
