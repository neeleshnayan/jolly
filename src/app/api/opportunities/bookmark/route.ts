/**
 * POST /api/opportunities/bookmark — { url } → save any job posting from the
 * wild into the matching pipeline (the Teal bookmark, minus the extension).
 * Fetches the page, strips it to text, stores it PENDING (vectorizedAt null) —
 * the same inference batch that handles board jobs analyzes it. Instant save,
 * no GPU contention with live calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, profiles } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";
import { strip, looksLikeCode, fetchViaAts } from "@/lib/jobs/jd";

export const runtime = "nodejs";
export const maxDuration = 30;

// user-supplied URL fetched server-side — keep it to public http(s) hosts
function urlAllowed(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === "[::1]"
  )
    return null;
  return u;
}

// strip / looksLikeCode / fetchViaAts moved to @/lib/jobs/jd — shared with the
// aggregator boards (a16z/Consider), which resolve JDs the same way

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { u?: string; url?: string };
    const userId = await resolveUserId(body.u);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const url = urlAllowed(body.url ?? "");
    if (!url) return NextResponse.json({ error: "That doesn't look like a public job URL" }, { status: 400 });

    // dedupe: same URL already saved → just say so
    const [existing] = await db
      .select({ id: opportunities.id, vectorizedAt: opportunities.vectorizedAt })
      .from(opportunities)
      .where(eq(opportunities.url, url.href))
      .limit(1);
    if (existing) {
      return NextResponse.json({ ok: true, already: true, pending: !existing.vectorizedAt });
    }

    // ATS APIs first (clean JD, real title); generic HTML scrape as fallback
    let title: string;
    let company: string;
    let text: string;
    const ats = await fetchViaAts(url).catch(() => null);
    if (ats && ats.jd.length >= 200) {
      title = ats.title.slice(0, 120);
      company = ats.company;
      text = ats.jd.slice(0, 20_000);
    } else {
      const res = await fetch(url.href, {
        headers: { "user-agent": "Mozilla/5.0 (drizzle job bookmark)" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return NextResponse.json({ error: `Couldn't fetch that page (${res.status})` }, { status: 422 });
      const html = (await res.text()).slice(0, 500_000);
      title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 120) || "Bookmarked role";
      company = url.hostname.replace(/^www\./, "");
      text = strip(html).slice(0, 20_000);
      if (text.length < 200 || looksLikeCode(text)) {
        return NextResponse.json(
          { error: "That page renders via JavaScript, so there's no readable JD in its HTML — paste the description into Target-a-job on the résumé tab instead" },
          { status: 422 },
        );
      }
    }

    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
    const [row] = await db
      .insert(opportunities)
      .values({
        source: "other",
        url: url.href,
        title,
        company,
        visibility: "private", // your find, your rankings — not everyone's
        rawText: text,
        vector: {},
        facts: {},
        vectorizedAt: null, // pending — next inference batch analyzes it
        addedByProfileId: p?.id ?? null,
      })
      .returning({ id: opportunities.id });

    return NextResponse.json({ ok: true, id: row.id, title, pending: true });
  } catch (err) {
    console.error("[/api/opportunities/bookmark]", err);
    const msg = err instanceof Error && err.name === "TimeoutError" ? "That page took too long to load" : "Failed to save";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
