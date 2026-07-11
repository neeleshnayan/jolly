import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, experiences, insights, mentorProbes, mentorCalls, applications, applicationEvents } from "@/db/schema";
import { buildTrajectory, type TrajectoryPoint } from "@/lib/mentor/trajectory";

export interface MentorMap {
  profile: { fullName: string | null; headline: string | null } | null;
  experiences: { title: string | null; org: string | null }[];
  insights: { dimension: string; content: string; confidence: number | null; stance?: string }[];
  probes: { question: string; rationale: string | null; dimension: string | null }[];
  // continuity: the relationship, not just the person
  previousCalls: { summary: string; createdAt: Date }[];
  activity: { company: string | null; role: string | null; status: string; lastResult: string | null; appliedAt: Date }[];
  // evolution: how their stance has MOVED over time (drizzle remembers growth)
  trajectory: TrajectoryPoint[];
}

/** The slice of the map the mentor needs to probe intelligently — including
 *  what was said in PAST calls and what they've DONE since (applications and
 *  outcomes), so call two continues the relationship instead of restarting. */
export async function getMentorMap(userId: string): Promise<MentorMap> {
  const [profile] = await db
    .select({ id: profiles.id, fullName: profiles.fullName, headline: profiles.headline })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) return { profile: null, experiences: [], insights: [], probes: [], previousCalls: [], activity: [], trajectory: [] };

  const [exps, ins, prbs, calls, apps] = await Promise.all([
    db
      .select({ title: experiences.title, org: experiences.org })
      .from(experiences)
      .where(eq(experiences.profileId, profile.id)),
    db
      .select({
        dimension: insights.dimension,
        content: insights.content,
        confidence: insights.confidence,
        stance: sql<string>`coalesce(${insights.data}->>'stance', 'conviction')`,
        createdAt: insights.createdAt, // dated — the trajectory needs WHEN
      })
      .from(insights)
      .where(and(eq(insights.profileId, profile.id), eq(insights.status, "active"))),
    db
      .select({
        question: mentorProbes.question,
        rationale: mentorProbes.rationale,
        dimension: mentorProbes.dimension,
      })
      .from(mentorProbes)
      .where(and(eq(mentorProbes.profileId, profile.id), eq(mentorProbes.status, "open"))),
    db
      .select({ summary: mentorCalls.summary, createdAt: mentorCalls.createdAt })
      .from(mentorCalls)
      .where(eq(mentorCalls.profileId, profile.id))
      .orderBy(desc(mentorCalls.createdAt))
      .limit(3),
    db
      .select({ id: applications.id, company: applications.company, role: applications.role, status: applications.status, appliedAt: applications.appliedAt })
      .from(applications)
      .where(eq(applications.profileId, profile.id))
      .orderBy(desc(applications.appliedAt))
      .limit(8),
  ]);

  // latest funnel event per application (the reason chosen on the kanban branch)
  let lastResults = new Map<string, string>();
  if (apps.length) {
    const events = await db
      .select({ applicationId: applicationEvents.applicationId, result: applicationEvents.result, createdAt: applicationEvents.createdAt })
      .from(applicationEvents)
      .where(inArray(applicationEvents.applicationId, apps.map((a) => a.id)))
      .orderBy(desc(applicationEvents.createdAt));
    lastResults = events.reduce((m, e) => {
      if (e.result && !m.has(e.applicationId)) m.set(e.applicationId, e.result);
      return m;
    }, new Map<string, string>());
  }

  return {
    profile: { fullName: profile.fullName, headline: profile.headline },
    experiences: exps,
    insights: ins,
    probes: prbs,
    previousCalls: calls,
    activity: apps.map((a) => ({
      company: a.company,
      role: a.role,
      status: a.status,
      lastResult: lastResults.get(a.id) ?? null,
      appliedAt: a.appliedAt,
    })),
    trajectory: buildTrajectory(ins, calls),
  };
}
