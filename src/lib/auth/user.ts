/**
 * The ONE way API routes resolve "which user is this request about".
 *
 * Session first, always. The `?u=` / body.userId parameter is a development
 * convenience (curl testing, the dev log-in-as flow) — honoring it in
 * production would let anyone read or write anyone else's data by guessing a
 * UUID. So outside development it is ignored entirely.
 * (Set ALLOW_USER_PARAM=1 to re-enable it temporarily, e.g. staging smoke tests.)
 */
import { getSessionUserId } from "./session";

export async function resolveUserId(supplied?: string | null): Promise<string | null> {
  const session = await getSessionUserId();
  if (session) return session;
  const devBypass = process.env.NODE_ENV !== "production" || process.env.ALLOW_USER_PARAM === "1";
  return devBypass && supplied ? supplied : null;
}
