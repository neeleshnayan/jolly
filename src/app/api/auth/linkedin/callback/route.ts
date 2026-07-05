/**
 * GET /api/auth/linkedin/callback — LinkedIn redirects here with `code` + `state`.
 * Verify state (CSRF), exchange the code, read the identity, upsert the profile,
 * set the session cookie, and land the user on their résumé.
 */
import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchUserinfo } from "@/lib/auth/linkedin";
import { upsertLinkedInUser } from "@/lib/auth/upsert";
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export const runtime = "nodejs";

function fail(req: NextRequest, reason: string) {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  if (error) return fail(req, error);

  const code = params.get("code");
  const state = params.get("state");
  const savedState = req.cookies.get("li_state")?.value;
  if (!code || !state || !savedState || state !== savedState) {
    return fail(req, "bad_state");
  }

  try {
    const token = await exchangeCode(code);
    const info = await fetchUserinfo(token);
    const userId = await upsertLinkedInUser(info);

    const res = NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
    res.cookies.set(SESSION_COOKIE, makeSessionToken(userId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    res.cookies.delete("li_state");
    return res;
  } catch (err) {
    console.error("[linkedin/callback]", err);
    return fail(req, "exchange_failed");
  }
}
