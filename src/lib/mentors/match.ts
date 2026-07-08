/**
 * Mentor Connect's core: people are matched on the EDGES they've traversed,
 * not attribute lists. A seeker attempting Goldman→PM wants someone who made
 * that exact move, not "a PM". Matching is deterministic (word overlap on the
 * from/to of transitions + expertise vs target) — no LLM, instant, explainable.
 *
 * The pre-brief is the marketplace's moat: every intro arrives with a
 * one-pager assembled from the diagnosis, so mentors never take a cold call.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { profiles, experiences, insights, mentorProfiles, resumeThemes } from "@/db/schema";
import { getSavedScoring } from "@/lib/scoring/persist";

const STOP = new Set(["the", "and", "for", "with", "from", "into", "over", "that", "this", "their", "your", "own", "who", "has", "was", "are", "through", "about", "than", "them", "they", "its", "his", "her", "ideal", "work", "process", "requires", "especially", "light", "trends", "potential", "personal"]);
const words = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  return a.filter((w) => set.has(w)).length / Math.min(a.length, b.length);
}

export type SeekerEdge = { from: string; to: string; targetWords: string[] };

/** The move this user is attempting: latest role → target role/aspiration. */
export async function deriveSeekerEdge(userId: string): Promise<SeekerEdge | null> {
  const [p] = await db.select({ id: profiles.id, headline: profiles.headline }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return null;
  const [latest] = await db
    .select({ title: experiences.title, org: experiences.org })
    .from(experiences)
    .where(eq(experiences.profileId, p.id))
    .orderBy(desc(experiences.isCurrent), desc(experiences.createdAt))
    .limit(1);
  const themes = await db.select().from(resumeThemes).where(eq(resumeThemes.profileId, p.id));
  const target = themes
    .map((t) => t.latentAttributes as { kind?: string; role?: string } | null)
    .find((a) => a?.kind === "target_role" && a.role)?.role;
  const aspirations = await db
    .select({ content: insights.content })
    .from(insights)
    .where(and(eq(insights.profileId, p.id), eq(insights.status, "active"), eq(insights.dimension, "aspiration")))
    .orderBy(desc(insights.createdAt))
    .limit(2);
  const from = [latest?.title, latest?.org].filter(Boolean).join(" at ") || p.headline || "";
  // an aspiration insight is a full sentence — clip it to a displayable phrase
  // (matching still uses ALL its words via targetWords). 60 chars keeps the
  // "A → B" line reading like a move, not a paragraph that trails off.
  const rawTo = target || aspirations[0]?.content || "";
  const to = rawTo.length > 60 ? `${rawTo.slice(0, 60).replace(/\s+\S*$/, "")}…` : rawTo;
  return { from, to, targetWords: [...words(target ?? ""), ...aspirations.flatMap((a) => words(a.content))] };
}

export type MentorMatch = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  journey: string | null;
  expertise: string[];
  transitions: { from: string; to: string }[];
  availability: string;
  feeHr: number | null;
  languages: string | null;
  timezone: string | null;
  score: number;
  why: string[];
};

/** Rank active mentors against the seeker's attempted edge. */
export async function matchMentors(userId: string, edge: SeekerEdge): Promise<MentorMatch[]> {
  const [me] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const rows = await db
    .select({
      m: mentorProfiles,
      name: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(mentorProfiles)
    .innerJoin(profiles, eq(profiles.id, mentorProfiles.profileId))
    .where(me ? and(eq(mentorProfiles.active, true), ne(mentorProfiles.profileId, me.id)) : eq(mentorProfiles.active, true))
    .then((rs) => rs.map((r) => ({ ...r.m, name: r.name, avatarUrl: r.avatarUrl })));

  const fromW = words(edge.from);
  const toW = [...words(edge.to), ...edge.targetWords];

  return rows
    .map((m) => {
      const why: string[] = [];
      let best = 0;
      for (const t of m.transitions ?? []) {
        const f = overlap(words(t.from), fromW);
        const g = overlap(words(t.to), toW);
        const s = 0.45 * f + 0.55 * g;
        if (s > best) best = s;
        if (f > 0.3 && g > 0.3) why.push(`Made the move you're attempting: ${t.from} → ${t.to}`);
        else if (g > 0.4) why.push(`Landed where you're aiming: ${t.to}`);
        else if (f > 0.4) why.push(`Started where you are: ${t.from}`);
      }
      const exp = overlap(m.expertise ?? [], toW) * 0.5 + overlap((m.expertise ?? []).flatMap(words), toW) * 0.5;
      if (exp > 0.25) why.push(`Expertise in what you're moving toward`);
      const avail = m.availability === "open" ? 0.1 : m.availability === "part-time" ? 0.05 : 0;
      const score = Math.min(1, best * 0.75 + exp * 0.2 + avail);
      return {
        id: m.id,
        name: m.name,
        avatarUrl: m.avatarUrl,
        headline: m.headline,
        journey: m.journey,
        expertise: m.expertise ?? [],
        transitions: m.transitions ?? [],
        availability: m.availability,
        feeHr: m.feeHr,
        languages: m.languages,
        timezone: m.timezone,
        score,
        why: [...new Set(why)].slice(0, 3),
      };
    })
    .filter((m) => m.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** The one-pager a mentor receives with every intro — assembled from the
 *  diagnosis, zero LLM cost. This is why intros here beat cold LinkedIn DMs. */
export async function buildPrebrief(userId: string, note?: string): Promise<string> {
  const [p] = await db
    .select({ id: profiles.id, fullName: profiles.fullName, headline: profiles.headline })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!p) return "";
  const edge = await deriveSeekerEdge(userId);
  const saved = await getSavedScoring(userId);
  const scoring = (saved.scoring ?? {}) as Record<string, { score: number; rationale: string }>;
  const defining = Object.entries(scoring)
    .map(([k, v]) => ({ k, v, d: Math.abs((v?.score ?? 0.5) - 0.5) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 3);
  const ins = await db
    .select({ dimension: insights.dimension, content: insights.content })
    .from(insights)
    .where(and(eq(insights.profileId, p.id), eq(insights.status, "active")))
    .orderBy(desc(insights.createdAt))
    .limit(6);

  return [
    `PRE-BRIEF · ${p.fullName ?? "Candidate"}${p.headline ? ` — ${p.headline}` : ""}`,
    edge?.from || edge?.to ? `\nTHE MOVE: ${edge.from || "?"} → ${edge.to || "exploring"}` : "",
    defining.length
      ? `\nDEFINING TRAITS (from their work-style read):\n${defining.map(({ k, v }) => `- ${k.replace(/_/g, " ")}: ${v.score >= 0.5 ? "high" : "low"} — ${v.rationale}`).join("\n")}`
      : "",
    ins.length ? `\nWHAT THEIR AI MENTOR HAS LEARNED:\n${ins.map((i) => `- [${i.dimension}] ${i.content}`).join("\n")}` : "",
    note ? `\nIN THEIR OWN WORDS (why this intro):\n"${note}"` : "",
    `\n— generated by drizzle from their résumé, work-style analysis, and mentor conversations`,
  ]
    .filter(Boolean)
    .join("\n");
}
