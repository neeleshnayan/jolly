/**
 * The cover letter's version store (a first-class document beside the résumé):
 *   GET  /api/cover-letters?u=  — versions, newest first
 *   POST /api/cover-letters     — save a version { content, label?, jd? }
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { coverLetters, profiles } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

async function profileId(userId: string): Promise<string | null> {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return p?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const pid = await profileId(userId);
  if (!pid) return NextResponse.json({ error: "No profile" }, { status: 404 });
  const versions = await db
    .select({ id: coverLetters.id, label: coverLetters.label, content: coverLetters.content, createdAt: coverLetters.createdAt })
    .from(coverLetters)
    .where(eq(coverLetters.profileId, pid))
    .orderBy(desc(coverLetters.createdAt))
    .limit(30);
  return NextResponse.json({ ok: true, versions });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; content?: string; label?: string; jd?: string; opportunityId?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const content = (body.content ?? "").trim();
  if (content.length < 40) return NextResponse.json({ error: "Letter looks empty" }, { status: 400 });
  const pid = await profileId(userId);
  if (!pid) return NextResponse.json({ error: "No profile" }, { status: 404 });
  const [row] = await db
    .insert(coverLetters)
    .values({
      profileId: pid,
      content,
      label: body.label?.slice(0, 80) || null,
      jd: body.jd?.slice(0, 12000) || null,
      opportunityId: typeof body.opportunityId === "string" ? body.opportunityId : null,
    })
    .returning({ id: coverLetters.id });
  return NextResponse.json({ ok: true, id: row.id });
}
