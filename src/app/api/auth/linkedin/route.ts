/**
 * GET /api/auth/linkedin — start the OAuth dance. Generate a random `state`,
 * stash it in a short-lived cookie (CSRF guard), and redirect to LinkedIn.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { authorizeUrl, linkedinConfigured } from "@/lib/auth/linkedin";

export const runtime = "nodejs";

export async function GET() {
  if (!linkedinConfigured()) {
    return NextResponse.json({ error: "LinkedIn is not configured" }, { status: 500 });
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("li_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 min
    path: "/",
  });
  return res;
}
