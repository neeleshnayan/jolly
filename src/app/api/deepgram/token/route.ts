/**
 * Mints a short-lived Deepgram token for the browser Voice Agent spike, so the
 * raw DEEPGRAM_API_KEY never ships to the client. Tries Deepgram's grant
 * endpoint; in dev, falls back to handing back the raw key so a LOCAL spike can
 * still open the socket (the key is a throwaway dev key). Not for production.
 */
import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

export async function GET() {
  if (!(await resolveUserId(null))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return NextResponse.json({ error: "DEEPGRAM_API_KEY not set" }, { status: 500 });

  try {
    const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 300 }),
    });
    if (r.ok) {
      const j = (await r.json()) as { access_token?: string; expires_in?: number };
      return NextResponse.json({ token: j.access_token, expiresIn: j.expires_in, raw: false });
    }
    const errText = (await r.text()).slice(0, 200);
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ token: key, raw: true, grantError: `grant ${r.status}: ${errText}` });
    }
    return NextResponse.json({ error: `grant ${r.status}: ${errText}` }, { status: 502 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.env.NODE_ENV !== "production") return NextResponse.json({ token: key, raw: true, grantError: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
