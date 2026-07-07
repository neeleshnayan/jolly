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
 *  email, else null. Use to gate both pages and API routes.
 *  Development bypass: on the local machine the control room just opens —
 *  chasing session cookies on your own rig helps nobody. Production always
 *  requires a signed session with an allowlisted email. */
export async function requireAdmin(): Promise<string | null> {
  const userId = await getSessionUserId();
  if (userId) {
    const allowed = adminEmails();
    if (allowed.length) {
      const [p] = await db.select({ email: profiles.email }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
      const email = p?.email?.toLowerCase();
      if (email && allowed.includes(email)) return userId;
    }
  }
  if (process.env.NODE_ENV !== "production") return "dev-admin";
  return null;
}
