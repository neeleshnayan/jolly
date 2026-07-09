/**
 * Turn the candidate + the stored roles into ranked, explained recommendations,
 * and pick a 3-role "spectrum" to prime the mentor before a call. Uses the
 * CACHED scoring vector (recomputed only when missing) so this is cheap.
 */
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { certifications, education, experiences, insights, opportunities, profiles, rankingSignals, resumeThemes, skills } from "@/db/schema";
import { deriveCandidateQuals, hardGate } from "./gates";
import { applyQualOverrides } from "@/lib/profile/about";
import { computeAndSaveScoring, getSavedScoring, recomputeScoringInBackground } from "@/lib/scoring/persist";
import { getPreferences, type Preferences } from "@/lib/preferences";
import { learnDrift, applyDrift, type LearnedDrift } from "./learn";
import { inferCurrency, inferCountry } from "@/lib/format/comp";
import { scoreMatch } from "./match";
import type { ScoringVector } from "@/lib/scoring/schema";
import type { OpportunityVector, OpportunityFacts } from "./schema";

export type RankedJob = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  country: string | null; // extraction's country, else inferred from location
  remote: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  stage: string | null;
  domain: string | null;
  url: string | null;
  source: string | null;
  summary: string;
  coreRequirements: string[];
  skills: string[]; // must+nice from extraction, normalized lowercase — the overlap lens
  fit: number;
  qualification: number;
  desire: number;
  evidence: number | null; // résumé-proven skill overlap (null = role lists no skills)
  trajectory: number | null; // toward who they're becoming (null = no direction set yet)
  novelty: number;
  building: number;
  peopleLeadership: number;
  reasons: string[];
  gaps: string[];
  why: string;
};

async function userVector(userId: string, wait = false): Promise<ScoringVector | null> {
  const saved = await getSavedScoring(userId);
  // fresh cache → serve it.
  if (saved.scoring && !saved.stale) return saved.scoring as unknown as ScoringVector;
  // no vector at all (brand-new user) → must compute inline; there's nothing to
  // show otherwise. Rare: it's computed on upload, so a vector normally exists.
  if (!saved.scoring) {
    try {
      return (await computeAndSaveScoring(userId)) as unknown as ScoringVector;
    } catch {
      return null;
    }
  }
  // stale, but we HAVE a usable vector. Reads must not block on the big-model
  // recompute — serve the cached one now and refresh in the background so the
  // next read is fresh. Only an explicit user Refresh (wait) pays to see the
  // updated ranking immediately.
  if (wait) {
    try {
      return (await computeAndSaveScoring(userId)) as unknown as ScoringVector;
    } catch {
      return saved.scoring as unknown as ScoringVector;
    }
  }
  recomputeScoringInBackground(userId);
  return saved.scoring as unknown as ScoringVector;
}

function whySummary(m: { fit: number; reasons: string[]; gaps: string[] }): string {
  const pct = Math.round(m.fit * 100);
  if (m.reasons.length) {
    const r = m.reasons.slice(0, 2).join(", and ").toLowerCase();
    return `${pct}% fit — ${r}${m.gaps.length ? `. Watch: ${m.gaps[0].toLowerCase()}` : ""}.`;
  }
  return `${pct}% fit for where you are right now.`;
}

// ---- evidence: what the résumé PROVES, not what the persona suggests ----
// Same containment matcher as the skill radar — "data mining & modelling"
// counts for "data mining"; "python" counts inside "python scripting".
const normSkill = (s: unknown) => String(s ?? "").toLowerCase().trim();
function skillEvidence(mine: string[], must: string[], nice: string[]) {
  const have = (s: string) => mine.some((m) => m === s || m.includes(s) || s.includes(m));
  const mustHave = must.filter(have);
  const niceHave = nice.filter(have);
  const mustHit = must.length ? mustHave.length / must.length : null;
  const niceHit = nice.length ? niceHave.length / nice.length : null;
  // a role that lists nothing gives no evidence either way → null (blend skips it)
  if (mustHit === null && niceHit === null) return { evidence: null as number | null, missing: [] as string[], proven: 0, of: 0 };
  // floor 0.35: a zero-overlap role sinks hard but stays visible with an honest gap
  const evidence = mustHit !== null ? 0.35 + 0.55 * mustHit + 0.1 * (niceHit ?? mustHit) : 0.5 + 0.5 * (niceHit as number);
  return { evidence, missing: must.filter((s) => !have(s)), proven: mustHave.length, of: must.length };
}

// ---- trajectory: does this role land closer to who they're becoming? ----
// Direction = the target role agreed on a mentor call (strong, explicit) +
// their latest aspiration/value insights (soft prose). Lexical overlap is a
// heuristic — floor 0.5 so a false negative dents, never buries.
const STOP = new Set(["the", "and", "for", "with", "that", "this", "who", "how", "their", "more", "than", "over", "across", "from", "into", "being", "want", "wants", "them", "they", "what", "when", "where", "will", "work"]);
const contentWords = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
function trajectoryFit(roleText: string, targetWords: string[], aspireWords: string[]): { score: number | null; targetHit: number } {
  const targetHit = targetWords.length ? targetWords.filter((w) => roleText.includes(w)).length / targetWords.length : 0;
  if (!targetWords.length && !aspireWords.length) return { score: null, targetHit: 0 };
  const aspireHits = aspireWords.filter((w) => roleText.includes(w)).length;
  const aspire = aspireWords.length ? Math.min(1, aspireHits / 4) : null;
  const combined =
    targetWords.length && aspire !== null ? 0.7 * targetHit + 0.3 * aspire : targetWords.length ? targetHit : (aspire as number);
  return { score: 0.5 + 0.5 * combined, targetHit };
}

// ---- concrete refinements the user states explicitly (comp + where/how) ----
// Rough FX to USD for RANKING only (a soft factor, not an exchange desk).
const TO_USD: Record<string, number> = { USD: 1, INR: 1 / 85, GBP: 1.27, EUR: 1.08 };
const compFmt = (n: number, cur: string) =>
  cur === "INR"
    ? n >= 100000
      ? `₹${Math.round(n / 100000)}L`
      : `₹${Math.round(n / 1000)}k`
    : `${cur === "USD" ? "$" : cur === "GBP" ? "£" : "€"}${Math.round(n / 1000)}k`;

/** The user states a RANGE: a floor they'd accept and a target they're aiming
 *  for. Roles at/above target rank clean; inside the range get a whisper of a
 *  penalty (they said they'd take it); below the floor sink hard. Compared in
 *  USD via rough FX; unknown job comp OR currency is NEUTRAL. */
function compRefine(pref: Preferences, compMin: number | null, compMax: number | null, jobCurrency: string | null) {
  const exp = pref.expectedComp;
  if (!exp) return { factor: 1 } as { factor: number; reason?: string; gap?: string };
  const userCur = pref.compCurrency ?? "INR"; // historical prefs predate the field and were entered in ₹
  const top = compMax ?? compMin;
  if (!top || !jobCurrency || !TO_USD[jobCurrency] || !TO_USD[userCur]) return { factor: 1 };
  const topUsd = top * TO_USD[jobCurrency];
  const expUsd = exp * TO_USD[userCur];
  // floor: stated acceptMin, else legacy currentComp, else 15% wiggle under target
  const floorUsd = (pref.acceptMin ?? pref.currentComp ?? exp * 0.85) * TO_USD[userCur];
  if (topUsd >= expUsd) return { factor: 1, reason: `Comp clears your ${compFmt(exp, userCur)} target` };
  if (topUsd >= floorUsd) return { factor: 0.95, reason: `Comp inside your acceptable range` };
  const ratio = topUsd / expUsd;
  return { factor: Math.max(0.6, 0.6 + 0.4 * ratio), gap: `Comp below the floor you'd accept` };
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

export async function rankMatchesWithMeta(userId: string, opts?: { wait?: boolean }): Promise<RankOutcome> {
  const base = await userVector(userId, opts?.wait ?? false);
  if (!base) return { matches: [], learning: { active: false, events: 0, confidence: 0 } };
  // visibility: global roles for everyone + THIS user's private bookmarks
  const [me] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  // Layer 2: the mentor call is the prior, behavior is the evidence — drift a
  // rank-time COPY of the vector toward what they actually choose (±0.15 max)
  const drift: LearnedDrift | null = me ? await learnDrift(me.id) : null;
  const vec = applyDrift(base, drift);
  // hard requirements are pass/fail — derive what this candidate can prove,
  // then apply any facts they've pinned on the About page (the user knows)
  const [candExps, candEdu, candCerts, candProfile] = me
    ? await Promise.all([
        db.select({ startDate: experiences.startDate }).from(experiences).where(eq(experiences.profileId, me.id)),
        db.select({ degree: education.degree }).from(education).where(eq(education.profileId, me.id)),
        db.select({ name: certifications.name, issuer: certifications.issuer }).from(certifications).where(eq(certifications.profileId, me.id)),
        db.select({ aboutOverrides: profiles.aboutOverrides }).from(profiles).where(eq(profiles.id, me.id)).limit(1),
      ])
    : [[], [], [], []];
  const quals = applyQualOverrides(
    deriveCandidateQuals({ experiences: candExps, education: candEdu, certifications: candCerts }),
    (candProfile[0]?.aboutOverrides ?? null) as Parameters<typeof applyQualOverrides>[1],
  );
  // the direction agreed on the mentor call: when a call lands on a target
  // role, fillTargetTheme writes it — and the ranking should FOLLOW the call.
  // Roles whose title/domain matches the agreed direction float up with an
  // explicit "why" so the user sees the conversation change their list.
  const targetWords: string[] = me
    ? await db
        .select({ latentAttributes: resumeThemes.latentAttributes })
        .from(resumeThemes)
        .where(eq(resumeThemes.profileId, me.id))
        .then((rows) => {
          const t = rows.map((r) => r.latentAttributes as { kind?: string; role?: string; pending?: boolean } | null).find((a) => a?.kind === "target_role" && a.role && !a.pending);
          return t?.role ? t.role.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2) : [];
        })
        .catch(() => [])
    : [];
  // the soft half of direction: their latest aspiration/value stances (the same
  // signals the growth trajectory is built from)
  const aspireWords: string[] = me
    ? await db
        .select({ dimension: insights.dimension, content: insights.content })
        .from(insights)
        .where(eq(insights.profileId, me.id))
        .orderBy(desc(insights.createdAt))
        .limit(20)
        .then((rows) => {
          const picks = rows.filter((r) => r.dimension === "aspiration" || r.dimension === "value").slice(0, 2);
          return [...new Set(picks.flatMap((p) => contentWords(p.content ?? "")))];
        })
        .catch(() => [])
    : [];
  // what the résumé PROVES — the evidence half of fit
  const mySkills: string[] = me
    ? await db
        .select({ name: skills.name })
        .from(skills)
        .where(eq(skills.profileId, me.id))
        .then((rows) => rows.map((r) => normSkill(r.name)).filter(Boolean))
        .catch(() => [])
    : [];
  const visible = me
    ? or(eq(opportunities.visibility, "global"), eq(opportunities.addedByProfileId, me.id))
    : eq(opportunities.visibility, "global");
  const [allRoles, pref] = await Promise.all([
    // only vectorized roles — a pending row's empty vector would fake 0.5 on
    // every axis and rank as a meaningless mid-pack match.
    // 500-row window: newest-first limit(100) was silently DROPPING older
    // roles from ranking as new batches vectorized (they vanished from the
    // user's list). Scoring is in-process arithmetic, so the real cost is
    // payload — revisit with per-user precomputed scores past ~1k roles.
    db
      .select()
      .from(opportunities)
      .where(and(isNotNull(opportunities.vectorizedAt), visible))
      .orderBy(desc(opportunities.createdAt))
      .limit(500),
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
      // hard requirements first: a missed credential or a big years shortfall
      // is a FILTER — no similarity score buys it back
      const gate = hardGate({ facts: f }, quals);
      if (!gate.pass) return null;
      const m = scoreMatch(vec, v);
      const c = compRefine(pref, r.compMin, r.compMax, f.comp_currency ?? inferCurrency(r.location));
      const l = locationRefine(pref, r.remote, r.location);
      // evidence: the role's asked-for skills vs what the résumé proves
      const roleSkills = [...new Set([...(f.must_have_skills ?? []), ...(f.nice_to_have_skills ?? [])].map(normSkill).filter(Boolean))];
      const ev = skillEvidence(mySkills, (f.must_have_skills ?? []).map(normSkill).filter(Boolean), (f.nice_to_have_skills ?? []).map(normSkill).filter(Boolean));
      // trajectory: title+domain+summary vs the direction they're heading
      const roleText = ` ${(r.title ?? "").toLowerCase()} ${(r.domain ?? "").toLowerCase()} ${(f.summary ?? "").toLowerCase()} ${roleSkills.join(" ")} `;
      const traj = trajectoryFit(roleText, targetWords, aspireWords);
      // fit = gate × blend(desire, evidence, trajectory) × concrete refinements.
      // Weights renormalize when a component is null, so missing data never
      // silently counts as a good (or bad) score.
      const parts: [number, number][] = [[m.desire, 0.45]];
      if (ev.evidence !== null) parts.push([ev.evidence, 0.35]);
      if (traj.score !== null) parts.push([traj.score, 0.2]);
      const core = parts.reduce((a, [x, w]) => a + x * w, 0) / parts.reduce((a, [, w]) => a + w, 0);
      const fit = Math.min(1, m.gate * core * c.factor * l.factor * (gate.marginal?.penalty ?? 1));
      // concrete notes lead — they're the explicit knobs the user just set
      const reasons = [
        traj.targetHit >= 0.5 ? "The direction you set with your mentor" : null,
        ev.evidence !== null && ev.of > 0 && ev.proven / ev.of >= 0.7 ? `Your résumé shows ${ev.proven} of ${ev.of} required skills` : null,
        c.reason,
        l.reason,
        ...m.reasons,
      ].filter(Boolean) as string[];
      const gaps = [
        gate.marginal?.gap,
        ev.evidence !== null && ev.of > 0 && ev.proven / ev.of < 0.5 && ev.missing.length
          ? `Asks for ${ev.missing.slice(0, 3).join(", ")} — not on your résumé`
          : null,
        c.gap,
        l.gap,
        ...m.gaps,
      ].filter(Boolean) as string[];
      // older rows predate the summary/core_requirements fields — fall back to
      // a trimmed JD slice so the card never shows a blank description
      const summary = f.summary?.trim() || (r.rawText ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
      const coreRequirements = f.core_requirements?.length ? f.core_requirements : f.must_have_skills ?? [];
      return {
        id: r.id,
        title: r.title,
        company: r.company,
        location: r.location,
        // deterministic FIRST: models bias to the company's home country (a US
        // firm's Singapore/Zürich office → "United States"), which breaks work-auth
        // gating. inferCountry parses the location correctly; the model only fills
        // locations the regex doesn't recognize.
        country: inferCountry(r.location) ?? (f.country as string | null) ?? null,
        remote: r.remote,
        compMin: r.compMin,
        compMax: r.compMax,
        compCurrency: f.comp_currency ?? null, // extraction wins; display falls back to location inference
        stage: r.companyStage,
        domain: r.domain,
        url: r.url,
        source: r.source,
        summary,
        coreRequirements,
        skills: roleSkills,
        fit,
        qualification: m.qualification,
        desire: m.desire,
        evidence: ev.evidence,
        trajectory: traj.score,
        novelty: v.off_domain_novelty?.score ?? 0.3,
        building: v.off_building?.score ?? 0.5,
        peopleLeadership: v.off_people_leadership?.score ?? 0.3,
        reasons,
        gaps,
        why: whySummary({ fit, reasons, gaps }),
      };
    })
    .filter((j): j is NonNullable<typeof j> => j !== null)
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
