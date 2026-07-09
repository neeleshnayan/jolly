/**
 * GET /api/apply-kit?opportunityId=… — everything a user needs staged while an
 * ATS application form is open in the next tab: copy-ready answers (the fiddly
 * fields every form asks), the latest cover letter, and the job's JD so the
 * client can generate a tailored letter on demand. The résumé PDF comes from
 * the existing /api/resume/pdf.
 *
 * Deliberately answer-shaped ([{key,label,value}]) so the drawer stays dumb.
 * EEOC/demographic questions are none of our business — never staged.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { coverLetters, opportunities, profiles } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";
import { getAboutFacts } from "@/lib/profile/about";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const opportunityId = req.nextUrl.searchParams.get("opportunityId");

    const [p] = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
        location: profiles.location,
        links: profiles.links,
        preferences: profiles.preferences,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

    const [about, [letter], job] = await Promise.all([
      getAboutFacts(userId),
      // THIS job's letter only — never the newest letter written for a different
      // role. No letter for this opportunity → null → the drawer offers to write
      // one. (A general letter, opportunityId null, is not shown against a job.)
      opportunityId
        ? db
            .select({ content: coverLetters.content, label: coverLetters.label })
            .from(coverLetters)
            .where(and(eq(coverLetters.profileId, p.id), eq(coverLetters.opportunityId, opportunityId)))
            .orderBy(desc(coverLetters.createdAt))
            .limit(1)
        : db
            .select({ content: coverLetters.content, label: coverLetters.label })
            .from(coverLetters)
            .where(eq(coverLetters.profileId, p.id))
            .orderBy(desc(coverLetters.createdAt))
            .limit(1),
      opportunityId
        ? db
            .select({ title: opportunities.title, company: opportunities.company, url: opportunities.url, rawText: opportunities.rawText })
            .from(opportunities)
            .where(eq(opportunities.id, opportunityId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    const linkedin = (p.links ?? []).find((l) => /linkedin/i.test(l.label) || /linkedin\.com/i.test(l.url))?.url ?? null;
    const prefs = (p.preferences ?? {}) as { expectedComp?: number };
    const expectedComp = prefs.expectedComp ? `₹${Math.round(prefs.expectedComp / 100000)} LPA` : null;

    // one honest list — null values render as "pin it on About" nudges
    const answers: { key: string; label: string; value: string | null }[] = [
      { key: "fullName", label: "Full name", value: p.fullName },
      { key: "email", label: "Email", value: p.email },
      { key: "phone", label: "Phone", value: p.phone },
      { key: "location", label: "Location", value: p.location },
      { key: "linkedin", label: "LinkedIn URL", value: linkedin },
      { key: "yearsExperience", label: "Years of experience", value: about?.yearsExperience.value != null ? String(about.yearsExperience.value) : null },
      { key: "noticePeriod", label: "Notice period", value: about?.noticePeriod.value ?? null },
      { key: "workAuthorization", label: "Work authorization", value: about?.workAuthorization.value ?? null },
      { key: "expectedComp", label: "Expected compensation", value: expectedComp },
    ];

    return NextResponse.json({
      ok: true,
      answers,
      letter: letter ? { content: letter.content, label: letter.label } : null,
      job: job ? { title: job.title, company: job.company, url: job.url, jd: (job.rawText ?? "").slice(0, 6000) } : null,
    });
  } catch (err) {
    console.error("[/api/apply-kit]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
