/**
 * The diagnosis report's data layer (user-facing, session-gated):
 *   GET  — everything the report renders: scoring vector, insights, open
 *          probes, target role, top matches. Pure reads, no inference.
 *   POST — generate the executive read (diagnosis agent). On demand because
 *          it's an LLM call; the client caches it in state.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, insights, mentorProbes, resumeThemes } from "@/db/schema";
import { getSavedScoring } from "@/lib/scoring/persist";
import { getAboutFacts } from "@/lib/profile/about";
import { rankMatches } from "@/lib/opportunities/recommend";
import { runAgent } from "@/agents/run";
import { diagnosisWriter } from "@/agents/diagnosis";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 120;

async function loadReport(userId: string) {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return null;
  const [ins, probes, themes, saved, matches, about] = await Promise.all([
    db
      .select({ dimension: insights.dimension, content: insights.content, confidence: insights.confidence, createdAt: insights.createdAt })
      .from(insights)
      .where(and(eq(insights.profileId, p.id), eq(insights.status, "active")))
      .orderBy(desc(insights.createdAt)),
    db
      .select({ question: mentorProbes.question, rationale: mentorProbes.rationale, dimension: mentorProbes.dimension })
      .from(mentorProbes)
      .where(and(eq(mentorProbes.profileId, p.id), eq(mentorProbes.status, "open"))),
    db.select().from(resumeThemes).where(eq(resumeThemes.profileId, p.id)),
    getSavedScoring(userId),
    rankMatches(userId).catch(() => []),
    getAboutFacts(userId),
  ]);
  const target = themes.find(
    (t) => (t.latentAttributes as { kind?: string; role?: string } | null)?.kind === "target_role",
  )?.latentAttributes as { role?: string; rationale?: string } | undefined;
  return {
    profile: { fullName: p.fullName, headline: p.headline },
    about,
    scoring: saved.scoring,
    scoringAt: saved.scoringAt,
    insights: ins,
    probes,
    targetRole: target?.role ? { role: target.role, rationale: target.rationale ?? "" } : null,
    topMatches: matches.slice(0, 3).map((m) => ({ title: m.title, company: m.company, fit: m.fit, url: m.url })),
  };
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const report = await loadReport(userId);
  if (!report) return NextResponse.json({ error: "No profile" }, { status: 404 });
  return NextResponse.json({ ok: true, ...report });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const report = await loadReport(userId);
  if (!report) return NextResponse.json({ error: "No profile" }, { status: 404 });

  // the material is the SAME data the report shows — the narrative can't know
  // anything the reader can't see below it
  const scoring = (report.scoring ?? {}) as Record<string, { score: number; rationale: string }>;
  const material = [
    `NAME: ${report.profile.fullName ?? "unknown"} — ${report.profile.headline ?? ""}`,
    `WORK-STYLE SCORES (0-1, with evidence):`,
    ...Object.entries(scoring).map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v.score} — ${v.rationale}`),
    report.insights.length ? `WHAT THE MENTOR HAS LEARNED:` : "",
    ...report.insights.map((i) => `- [${i.dimension}] ${i.content}`),
    report.targetRole ? `CURRENT TARGET: ${report.targetRole.role} — ${report.targetRole.rationale}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { output } = await runAgent(diagnosisWriter, { material }, { userId });
    // belt & braces: local models sneak markdown emphasis into prose
    const plain = (s: string) => s.replace(/\*\*?([^*\n]+)\*\*?/g, "$1").replace(/__([^_\n]+)__/g, "$1");
    return NextResponse.json({
      ok: true,
      readline: plain(output.readline),
      narrative: output.narrative.map(plain),
      moves: output.moves.map(plain),
    });
  } catch (err) {
    console.error("[/api/insights/report]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
