/**
 * Turn the candidate + the stored roles into ranked, explained recommendations,
 * and pick a 3-role "spectrum" to prime the mentor before a call. Uses the
 * CACHED scoring vector (recomputed only when missing) so this is cheap.
 */
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { computeAndSaveScoring, getSavedScoring } from "@/lib/scoring/persist";
import { scoreMatch } from "./match";
import type { ScoringVector } from "@/lib/scoring/schema";
import type { OpportunityVector } from "./schema";

export type RankedJob = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  remote: string | null;
  compMin: number | null;
  compMax: number | null;
  stage: string | null;
  domain: string | null;
  url: string | null;
  fit: number;
  qualification: number;
  desire: number;
  novelty: number;
  building: number;
  peopleLeadership: number;
  reasons: string[];
  gaps: string[];
  why: string;
};

async function userVector(userId: string): Promise<ScoringVector | null> {
  const saved = await getSavedScoring(userId);
  if (saved.scoring) return saved.scoring as unknown as ScoringVector;
  try {
    return (await computeAndSaveScoring(userId)) as unknown as ScoringVector;
  } catch {
    return null;
  }
}

function whySummary(m: { fit: number; reasons: string[]; gaps: string[] }): string {
  const pct = Math.round(m.fit * 100);
  if (m.reasons.length) {
    const r = m.reasons.slice(0, 2).join(", and ").toLowerCase();
    return `${pct}% fit — ${r}${m.gaps.length ? `. Watch: ${m.gaps[0].toLowerCase()}` : ""}.`;
  }
  return `${pct}% fit for where you are right now.`;
}

export async function rankMatches(userId: string): Promise<RankedJob[]> {
  const vec = await userVector(userId);
  if (!vec) return [];
  const roles = await db.select().from(opportunities).orderBy(desc(opportunities.createdAt)).limit(100);
  return roles
    .map((r) => {
      const v = (r.vector ?? {}) as OpportunityVector;
      const m = scoreMatch(vec, v);
      return {
        id: r.id,
        title: r.title,
        company: r.company,
        location: r.location,
        remote: r.remote,
        compMin: r.compMin,
        compMax: r.compMax,
        stage: r.companyStage,
        domain: r.domain,
        url: r.url,
        fit: m.fit,
        qualification: m.qualification,
        desire: m.desire,
        novelty: v.off_domain_novelty?.score ?? 0.3,
        building: v.off_building?.score ?? 0.5,
        peopleLeadership: v.off_people_leadership?.score ?? 0.3,
        reasons: m.reasons,
        gaps: m.gaps,
        why: whySummary(m),
      };
    })
    .sort((a, b) => b.fit - a.fit);
}

/**
 * Three roles that span the spectrum, to open the call with: one they clearly
 * fit, one that's a stretch (they'd want it but aren't fully qualified yet), and
 * one pivot (a genuinely different direction). Great "which pulls at you, and
 * why?" material.
 */
export function pickSpectrum(ranked: RankedJob[]): { kind: string; job: RankedJob }[] {
  if (!ranked.length) return [];
  const picks: { kind: string; job: RankedJob }[] = [];
  const used = new Set<string>();
  const take = (kind: string, job?: RankedJob) => {
    if (job && !used.has(job.id)) {
      picks.push({ kind, job });
      used.add(job.id);
    }
  };

  const top = ranked[0];
  take("Strong fit", top);
  const remain = () => ranked.filter((j) => !used.has(j.id));
  // a genuinely different life: the reasonably-ranked role whose shape (build vs
  // lead) is furthest from the top pick — the "would you rather build or lead?"
  const shapeDist = (j: RankedJob) =>
    Math.hypot(j.building - top.building, j.peopleLeadership - top.peopleLeadership);
  const contrast = remain()
    .filter((j) => j.fit > 0.45)
    .sort((a, b) => shapeDist(b) - shapeDist(a))[0];
  take("A different path", contrast);
  // a pivot: the most different domain
  const pivot = remain().sort((a, b) => b.novelty - a.novelty)[0];
  take("A pivot", pivot);

  return picks.slice(0, 3);
}

/** The 3-role spectrum flattened for the mentor prompt (empty if no jobs yet). */
export async function getCallSpectrum(
  userId: string,
): Promise<{ kind: string; title: string; company: string; why: string }[]> {
  const ranked = await rankMatches(userId);
  return pickSpectrum(ranked).map((s) => ({
    kind: s.kind,
    title: s.job.title ?? "a role",
    company: s.job.company ?? "",
    why: s.job.why,
  }));
}
