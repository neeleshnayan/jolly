/**
 * Turn the candidate + the stored roles into ranked, explained recommendations,
 * and pick a 3-role "spectrum" to prime the mentor before a call. Uses the
 * CACHED scoring vector (recomputed only when missing) so this is cheap.
 */
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, profiles, rankingSignals } from "@/db/schema";
import { computeAndSaveScoring, getSavedScoring } from "@/lib/scoring/persist";
import { getPreferences, type Preferences } from "@/lib/preferences";
import { learnDrift, applyDrift, type LearnedDrift } from "./learn";
import { scoreMatch } from "./match";
import type { ScoringVector } from "@/lib/scoring/schema";
import type { OpportunityVector, OpportunityFacts } from "./schema";

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
  source: string | null;
  summary: string;
  coreRequirements: string[];
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

// ---- concrete refinements the user states explicitly (comp + where/how) ----
const compFmt = (n: number) => (n >= 100000 ? `₹${Math.round(n / 100000)}L` : `₹${Math.round(n / 1000)}k`);

/** How well the role's stated pay meets the user's expectation. Unknown comp is
 *  neutral (never penalized). Below target is a soft, proportional penalty. */
function compRefine(pref: Preferences, compMin: number | null, compMax: number | null) {
  const exp = pref.expectedComp;
  if (!exp) return { factor: 1 } as { factor: number; reason?: string; gap?: string };
  const top = compMax ?? compMin;
  if (!top) return { factor: 1 };
  if (top >= exp) return { factor: 1, reason: `Comp clears your ${compFmt(exp)} target` };
  const ratio = top / exp;
  return { factor: Math.max(0.6, 0.6 + 0.4 * ratio), gap: `Comp ~${Math.round((1 - ratio) * 100)}% under your target` };
}

/** Location / remote compatibility — soft factors so nothing is hidden, just
 *  ranked lower when it clashes with how the user wants to work. */
function locationRefine(pref: Preferences, remote: string | null, location: string | null) {
  let factor = 1;
  let reason: string | undefined;
  let gap: string | undefined;
  const want = pref.remote;
  const isRemote = remote === "remote";
  if (want && want !== "any" && remote && remote !== "unknown") {
    if (want === "remote" && !isRemote) {
      factor *= 0.7;
      gap = "Not remote — you wanted remote";
    } else if (want === "onsite" && isRemote) {
      factor *= 0.92;
    } else if (isRemote || want === remote) {
      reason = isRemote ? "Remote" : `${remote[0].toUpperCase()}${remote.slice(1)}`;
    }
  }
  if (pref.locations?.length && !isRemote && location) {
    const loc = location.toLowerCase();
    const hit = pref.locations.find((c) => loc.includes(c.toLowerCase()));
    if (hit) reason = `In ${hit}`;
    else if (want !== "remote") {
      factor *= 0.82;
      gap = gap ?? `${location} — outside your locations`;
    }
  }
  return { factor, reason, gap };
}

export type RankOutcome = { matches: RankedJob[]; learning: { active: boolean; events: number; confidence: number } };

export async function rankMatches(userId: string): Promise<RankedJob[]> {
  return (await rankMatchesWithMeta(userId)).matches;
}

export async function rankMatchesWithMeta(userId: string): Promise<RankOutcome> {
  const base = await userVector(userId);
  if (!base) return { matches: [], learning: { active: false, events: 0, confidence: 0 } };
  // visibility: global roles for everyone + THIS user's private bookmarks
  const [me] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  // Layer 2: the mentor call is the prior, behavior is the evidence — drift a
  // rank-time COPY of the vector toward what they actually choose (±0.15 max)
  const drift: LearnedDrift | null = me ? await learnDrift(me.id) : null;
  const vec = applyDrift(base, drift);
  const visible = me
    ? or(eq(opportunities.visibility, "global"), eq(opportunities.addedByProfileId, me.id))
    : eq(opportunities.visibility, "global");
  const [allRoles, pref] = await Promise.all([
    // only vectorized roles — a pending row's empty vector would fake 0.5 on
    // every axis and rank as a meaningless mid-pack match
    db
      .select()
      .from(opportunities)
      .where(and(isNotNull(opportunities.vectorizedAt), visible))
      .orderBy(desc(opportunities.createdAt))
      .limit(100),
    getPreferences(userId),
  ]);
  // "Not for me" is a promise: dismissed roles never rank again for this user.
  const dismissed = me
    ? new Set(
        (
          await db
            .select({ opportunityId: rankingSignals.opportunityId })
            .from(rankingSignals)
            .where(and(eq(rankingSignals.profileId, me.id), eq(rankingSignals.kind, "dismiss")))
        ).map((r) => r.opportunityId),
      )
    : new Set<string>();
  // Curated fixtures are a FALLBACK, not content: the moment real ATS-fetched
  // roles exist, only real ones are ranked. (Samples stay in the DB so an empty
  // deployment still demos, but users should never see them next to real jobs.)
  const undismissed = allRoles.filter((r) => !dismissed.has(r.id));
  const real = undismissed.filter((r) => r.source !== "sample");
  const roles = real.length ? real : undismissed;
  const ranked = roles
    .map((r) => {
      const v = (r.vector ?? {}) as OpportunityVector;
      const f = (r.facts ?? {}) as Partial<OpportunityFacts>;
      const m = scoreMatch(vec, v);
      const c = compRefine(pref, r.compMin, r.compMax);
      const l = locationRefine(pref, r.remote, r.location);
      // concrete notes lead — they're the explicit knobs the user just set
      const reasons = [c.reason, l.reason, ...m.reasons].filter(Boolean) as string[];
      const gaps = [c.gap, l.gap, ...m.gaps].filter(Boolean) as string[];
      // older rows predate the summary/core_requirements fields — fall back to
      // a trimmed JD slice so the card never shows a blank description
      const summary = f.summary?.trim() || (r.rawText ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
      const coreRequirements = f.core_requirements?.length ? f.core_requirements : f.must_have_skills ?? [];
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
        source: r.source,
        summary,
        coreRequirements,
        fit: m.fit * c.factor * l.factor,
        qualification: m.qualification,
        desire: m.desire,
        novelty: v.off_domain_novelty?.score ?? 0.3,
        building: v.off_building?.score ?? 0.5,
        peopleLeadership: v.off_people_leadership?.score ?? 0.3,
        reasons,
        gaps,
        why: whySummary(m),
      };
    })
    .sort((a, b) => b.fit - a.fit);

  // Diversity guard: scores compress at the top (several 95-97% roles), so
  // whichever company vectorized most recently would own the whole visible
  // top-5. Cap each company at 2 head-of-list slots; overflow keeps its rank
  // order afterwards — nothing hidden, just interleaved.
  const head: RankedJob[] = [];
  const tail: RankedJob[] = [];
  const perCompany = new Map<string, number>();
  for (const j of ranked) {
    const n = perCompany.get(j.company ?? "?") ?? 0;
    if (n < 2) {
      head.push(j);
      perCompany.set(j.company ?? "?", n + 1);
    } else {
      tail.push(j);
    }
  }
  return {
    matches: [...head, ...tail],
    learning: { active: !!drift && drift.confidence > 0, events: drift?.events ?? 0, confidence: drift?.confidence ?? 0 },
  };
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
