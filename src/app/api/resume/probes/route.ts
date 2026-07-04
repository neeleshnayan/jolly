/**
 * GET /api/resume/probes?u=<userId> — progress for the background probe pass.
 * Reads the agent_runs log (the runner already records probe-generator runs) plus
 * the probe count, so the résumé page can show a progress bar. Cheap; poll it.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, mentorProbes, agentRuns } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("u");
  if (!userId) return NextResponse.json({ error: "Missing ?u=" }, { status: 400 });

  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!profile) return NextResponse.json({ count: 0, generating: false });

  const [countRow, lastRun] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(mentorProbes)
      .where(eq(mentorProbes.profileId, profile.id)),
    db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(and(eq(agentRuns.profileId, profile.id), eq(agentRuns.agent, "probe-generator")))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1),
  ]);

  return NextResponse.json({
    count: countRow[0]?.n ?? 0,
    generating: lastRun[0]?.status === "running",
  });
}
