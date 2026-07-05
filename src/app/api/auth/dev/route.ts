/**
 * GET /api/auth/dev?u=<userId> — dev-only "log in as". Sets a real session
 * cookie for the given profile userId so the whole session-first app is
 * testable without the LinkedIn round-trip. Hard-disabled in production.
 */
import { NextRequest, NextResponse } from "next/server";
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return NextResponse.json({ error: "Missing ?u=<userId>" }, { status: 400 });

  const res = NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, makeSessionToken(u), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
