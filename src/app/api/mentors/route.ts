/**
 * Mentor Connect:
 *   GET  /api/mentors — your mentor profile (if any), your matches, and a
 *        preview of YOUR pre-brief (what a mentor would receive about you)
 *   POST /api/mentors — become a mentor / update your mentor profile
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mentorProfiles, profiles } from "@/db/schema";
import { deriveSeekerEdge, matchMentors, buildPrebrief } from "@/lib/mentors/match";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const [me] = await db.select().from(mentorProfiles).where(eq(mentorProfiles.profileId, p.id)).limit(1);
  const edge = await deriveSeekerEdge(userId);
  const matches = edge ? await matchMentors(userId, edge) : [];
  const prebriefPreview = await buildPrebrief(userId);

  return NextResponse.json({ ok: true, me: me ?? null, edge, matches, prebriefPreview });
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
