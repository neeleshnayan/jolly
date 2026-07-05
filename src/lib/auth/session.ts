/**
 * Minimal, dependency-free session cookie. The cookie value is
 * `userId|issuedAtMs` signed with an HMAC (SESSION_SECRET) so it can't be forged
 * or tampered with. No server-side session store — the signed cookie IS the
 * session. Good enough for v0; swap for a real store when we need revocation.
 */
import crypto from "crypto";
import { cookies } from "next/headers";

const SECRET = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";
export const SESSION_COOKIE = "jolly_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (seconds)

function hmac(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function makeSessionToken(userId: string): string {
  const payload = `${userId}|${Date.now()}`;
  return `${payload}.${hmac(payload)}`;
}

export function readSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = hmac(payload);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const [userId, tsStr] = payload.split("|");
  const ts = Number(tsStr);
  if (!userId || !ts || Date.now() - ts > SESSION_MAX_AGE * 1000) return null;
  return userId;
}

/** Current signed-in userId from the request cookies, or null. Server-only. */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}
