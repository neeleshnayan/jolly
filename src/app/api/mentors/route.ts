/**
 * Mentor Connect:
 *   GET  /api/mentors — your mentor profile (if any), your matches, and a
 *        preview of YOUR pre-brief (what a mentor would receive about you)
 *   POST /api/mentors — become a mentor / update your mentor profile
 */
import { NextRequest, NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { experiences, mentorProfiles, profiles, skills } from "@/db/schema";
import { deriveSeekerEdge, matchMentors, buildPrebrief } from "@/lib/mentors/match";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

/** Pre-fill the become-a-mentor form from what drizzle already knows — the
 *  form should feel like CONFIRMING, not writing. Transitions come from the
 *  actual career sequence (each consecutive role pair is a traversed edge). */
async function buildSuggested(profileId: string) {
  const [p] = await db
    .select({ headline: profiles.headline, location: profiles.location })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  // résumé display order (position asc) = newest first; reversed below gives
  // oldest→newest, which is how a career path reads
  const exps = await db
    .select({ title: experiences.title, org: experiences.org, isCurrent: experiences.isCurrent })
    .from(experiences)
    .where(eq(experiences.profileId, profileId))
    .orderBy(asc(experiences.position), desc(experiences.createdAt));
  const sk = await db.select({ name: skills.name }).from(skills).where(eq(skills.profileId, profileId)).orderBy(asc(skills.position)).limit(8);

  // exps come newest-first; walk oldest→newest so edges read chronologically
  const chrono = [...exps].reverse().map((e) => [e.title, e.org].filter(Boolean).join(" at ")).filter(Boolean);
  const transitions: { from: string; to: string }[] = [];
  for (let i = 0; i + 1 < chrono.length && transitions.length < 4; i++) {
    transitions.push({ from: chrono[i], to: chrono[i + 1] });
  }
  const journey =
    chrono.length >= 2
      ? `My path: ${chrono.join(" → ")}. Happy to talk honestly about what each jump actually took.`
      : "";
  const tz = /india|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai/i.test(p?.location ?? "") ? "IST" : "";

  return {
    headline: p?.headline ?? "",
    journey,
    expertise: sk.map((s) => s.name),
    transitions,
    timezone: tz,
  };
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const [me] = await db.select().from(mentorProfiles).where(eq(mentorProfiles.profileId, p.id)).limit(1);
  const edge = await deriveSeekerEdge(userId);
  const matches = edge ? await matchMentors(userId, edge) : [];
  const prebriefPreview = await buildPrebrief(userId);
  const suggested = me ? null : await buildSuggested(p.id);

  return NextResponse.json({ ok: true, me: me ?? null, suggested, edge, matches, prebriefPreview });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    u?: string;
    headline?: string;
    journey?: string;
    expertise?: string[];
    transitions?: { from: string; to: string }[];
    languages?: string;
    timezone?: string;
    availability?: string;
    feeHr?: number | null;
    active?: boolean;
  };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const clean = {
    headline: (body.headline ?? "").slice(0, 140) || null,
    journey: (body.journey ?? "").slice(0, 2000) || null,
    expertise: (Array.isArray(body.expertise) ? body.expertise : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 12),
    transitions: (Array.isArray(body.transitions) ? body.transitions : [])
      .map((t) => ({ from: String(t?.from ?? "").slice(0, 120).trim(), to: String(t?.to ?? "").slice(0, 120).trim() }))
      .filter((t) => t.from && t.to)
      .slice(0, 6),
    languages: (body.languages ?? "").slice(0, 120) || null,
    timezone: (body.timezone ?? "").slice(0, 60) || null,
    availability: ["occasionally", "part-time", "open"].includes(body.availability ?? "") ? body.availability! : "occasionally",
    feeHr: typeof body.feeHr === "number" && body.feeHr > 0 ? Math.round(body.feeHr) : null,
    active: body.active !== false,
    updatedAt: new Date(),
  };

  await db
    .insert(mentorProfiles)
    .values({ profileId: p.id, ...clean })
    .onConflictDoUpdate({ target: mentorProfiles.profileId, set: clean });
  return NextResponse.json({ ok: true });
}
