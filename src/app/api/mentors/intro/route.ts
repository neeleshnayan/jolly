/**
 * POST /api/mentors/intro — { mentorId, note? } → an intro request with an
 * auto-generated pre-brief. v0: the founder brokers these manually; the
 * product's job is the MATCH and the BRIEF, not the plumbing.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mentorIntros, mentorProfiles, profiles } from "@/db/schema";
import { buildPrebrief } from "@/lib/mentors/match";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; mentorId?: string; note?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!body.mentorId) return NextResponse.json({ error: "Missing mentorId" }, { status: 400 });

  const [p] = await db.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });
  const [mentor] = await db
    .select({ id: mentorProfiles.id, contactEmail: mentorProfiles.contactEmail, name: profiles.fullName })
    .from(mentorProfiles)
    .innerJoin(profiles, eq(profiles.id, mentorProfiles.profileId))
    .where(eq(mentorProfiles.id, body.mentorId))
    .limit(1);
  if (!mentor) return NextResponse.json({ error: "Mentor not found" }, { status: 404 });

  // one open request per mentor per seeker — no spamming
  const [existing] = await db
    .select({ id: mentorIntros.id })
    .from(mentorIntros)
    .where(and(eq(mentorIntros.seekerProfileId, p.id), eq(mentorIntros.mentorProfileId, mentor.id), eq(mentorIntros.status, "requested")))
    .limit(1);
  const note = (body.note ?? "").slice(0, 500);
  const prebrief = await buildPrebrief(userId, note || undefined);

  // the request is logged either way; when the mentor shared a contact email,
  // ALSO hand back a ready-to-send draft (mailto) — the seeker sends it from
  // their own mail client, drizzle never emails anyone on their behalf
  const mailto = mentor.contactEmail
    ? `mailto:${mentor.contactEmail}?subject=${encodeURIComponent(
        `Mentorship request — ${p.name ?? "a drizzle seeker"}`,
      )}&body=${encodeURIComponent(
        `Hi ${(mentor.name ?? "").split(" ")[0] || "there"},\n\n${
          note || "I'd love to learn from the move you've made — could we talk?"
        }\n\nA short brief about me:\n\n${prebrief.slice(0, 900)}\n\n— ${p.name ?? ""} (matched via drizzle)`,
      )}`
    : null;

  if (existing) return NextResponse.json({ ok: true, already: true, mailto });
  await db.insert(mentorIntros).values({ seekerProfileId: p.id, mentorProfileId: mentor.id, prebrief, note: note || null });
  return NextResponse.json({ ok: true, mailto });
}
