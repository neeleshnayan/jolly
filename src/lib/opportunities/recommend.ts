/**
 * Turn the candidate + the stored roles into ranked, explained recommendations,
 * and pick a 3-role "spectrum" to prime the mentor before a call. Uses the
 * CACHED scoring vector (recomputed only when missing) so this is cheap.
 */
import { sql } from "drizzle-orm";
import { db, withScopedDb } from "@/db";
import { deriveCandidateQuals, hardGate } from "./gates";
import { applyQualOverrides } from "@/lib/profile/about";
import { computeAndSaveScoring, recomputeScoringInBackground } from "@/lib/scoring/persist";
import { type Preferences } from "@/lib/preferences";
import { distillSignals, applyDrift, type LearnedDrift } from "./learn";
import { inferCurrency, inferCountry } from "@/lib/format/comp";
import { toUSD, fmtMoney } from "@/lib/format/currency";
import { scoreMatch } from "./match";
import { blendCore, relevanceDamp } from "./blend";
import { TRUSTED_MODELS } from "@/lib/jobs/vectorize";
import { canonSkillKey } from "@/lib/skills/canon";
import { firstCityHit } from "@/lib/geo/canon";
import { embed, trajectoryFromCosine, directionEmbedText } from "@/lib/embeddings";
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
  minYears: number | null; // required experience (company_stage was too noisy to show)
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
// canonical key, not just lowercase: "K8s" on a résumé must earn evidence
// against "Kubernetes" in a JD, and model-casing variants must be one skill
const normSkill = (s: unknown) => canonSkillKey(String(s ?? ""));
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

/** The user states a RANGE: a floor they'd accept and a target they're aiming
 *  for. Roles at/above target rank clean; inside the range get a whisper of a
 *  penalty (they said they'd take it); below the floor sink hard. Compared in
 *  USD via the shared currency table (lib/format/currency — any ISO the
 *  extraction emits, not just the big four); unknown comp OR currency is
 *  NEUTRAL, never a penalty. */
function compRefine(pref: Preferences, compMin: number | null, compMax: number | null, jobCurrency: string | null) {
  const exp = pref.expectedComp;
  if (!exp) return { factor: 1 } as { factor: number; reason?: string; gap?: string };
  const userCur = pref.compCurrency ?? "INR"; // historical prefs predate the field and were entered in ₹
  const top = compMax ?? compMin;
  if (!top) return { factor: 1 };
  const topUsd = toUSD(top, jobCurrency);
  const expUsd = toUSD(exp, userCur);
  if (topUsd === null || expUsd === null) return { factor: 1 };
  // floor: stated acceptMin, else legacy currentComp, else 15% wiggle under target
  const floorUsd = toUSD(pref.acceptMin ?? pref.currentComp ?? exp * 0.85, userCur) as number;
  if (topUsd >= expUsd) return { factor: 1, reason: `Comp clears your ${fmtMoney(exp, userCur)} target` };
  if (topUsd >= floorUsd) return { factor: 0.95, reason: `Comp inside your acceptable range` };
  const ratio = topUsd / expUsd;
  return { factor: Math.max(0.6, 0.6 + 0.4 * ratio), gap: `Comp below the floor you'd accept` };
}

/** Location / remote compatibility — soft factors so nothing is hidden, just
 *  ranked lower when it clashes with how the user wants to work. */
/** Two-tier location semantics (city matching is CANONICAL — "NYC" finds
 *  "New York City, NY", "Bengaluru" finds "Bangalore, India"):
 *    locations   = FILTER — where they'd actually take a job; a non-remote role
 *                  outside locations ∪ dreamCities returns exclude:true and
 *                  never ranks. Remote roles always pass (they satisfy any city).
 *    dreamCities = BOOST — aspirational; roles there rank ~12% higher with a
 *                  ✨ reason. Dream ⊆ acceptable is implied (you'd move for it). */
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
  const dreamHit = firstCityHit(location, pref.dreamCities);
  if (dreamHit) {
    factor *= 1.12;
    reason = `✨ ${dreamHit} — your dream city`;
  } else if (pref.locations?.length && !isRemote && location) {
    const hit = firstCityHit(location, pref.locations);
    if (hit) reason = reason ?? `In ${hit}`;
    else return { factor, reason, gap, exclude: true as const }; // the FILTER
  }
  return { factor, reason, gap, exclude: false as const };
}

export type RankOutcome = {
  matches: RankedJob[];
  learning: { active: boolean; events: number; confidence: number };
  /** the user's skills as canonical keys — returned so callers (the matches
   *  route's skill radar) don't need their own DB round-trips */
  userSkillKeys: string[];
};

export async function rankMatches(userId: string): Promise<RankedJob[]> {
  return (await rankMatchesWithMeta(userId)).matches;
}

export async function rankMatchesWithMeta(userId: string, opts?: { wait?: boolean }): Promise<RankOutcome> {
  // ONE round-trip: every ranking input, gathered WHERE THE DATA LIVES — the
  // get_ranking_inputs Postgres RPC (tools/create-ranking-rpc.ts). The old ~12-query
  // fan-out was fine from Node, but from a Cloudflare Worker each query was an
  // ocean round-trip to the DB region and the request kept blowing past the
  // Workers hang limit (the intermittent matches 500s). The validated blend math
  // below is unchanged — only the gathering moved into the DB.
  type RpcPoolRow = {
    id: string; title: string | null; company: string | null; location: string | null;
    remote: string | null; compMin: number | null; compMax: number | null;
    domain: string | null; url: string | null; source: string | null;
    vector: unknown; facts: unknown; rawText: string | null; trajDist: number | null;
  };
  type RpcInputs = {
    profile: { id: string; scoring: Record<string, unknown> | null; scoringStale: boolean | null; preferences: Preferences | null; aboutOverrides: unknown } | null;
    experiences: { startDate: string | null }[];
    education: { degree: string | null }[];
    certifications: { name: string | null; issuer: string | null }[];
    skills: string[];
    themes: ({ kind?: string; role?: string; pending?: boolean } | null)[];
    insights: { dimension: string; content: string | null }[];
    signals: { kind: string; vector: unknown }[];
    dismissed: string[];
    pool: RpcPoolRow[];
  };
  // scoped client: on CF this is ONE fresh client → ONE query → end()-ed
  // in-request, the strictest TCP discipline Workers allow (leftover sockets
  // were poisoning isolates). On Node it's just the shared pool.
  const rpcRes = (await withScopedDb((d) =>
    d.execute(sql`SELECT get_ranking_inputs(${userId}::uuid, ${TRUSTED_MODELS}::text[], null) AS inputs`),
  )) as unknown;
  // postgres-js (Node) returns the row array directly; node-postgres (CF scoped
  // client) returns a Result with .rows — normalize.
  const rpcRows = (Array.isArray(rpcRes) ? rpcRes : (rpcRes as { rows: unknown[] }).rows) as { inputs: RpcInputs }[];
  const inputs = rpcRows[0]?.inputs;
  if (!inputs) return { matches: [], learning: { active: false, events: 0, confidence: 0 }, userSkillKeys: [] };
  const me = inputs.profile;

  // scoring vector: fresh cache → serve; missing (brand-new user) → compute inline;
  // stale → serve cached + refresh in the background (Node only — a floating
  // promise wedges a Worker isolate); explicit Refresh (wait) recomputes inline.
  let base = (me?.scoring ?? null) as unknown as ScoringVector | null;
  const stale = !!me?.scoringStale;
  if (!base) {
    try { base = (await computeAndSaveScoring(userId)) as unknown as ScoringVector; } catch { base = null; }
  } else if (stale && opts?.wait) {
    try { base = (await computeAndSaveScoring(userId)) as unknown as ScoringVector; } catch { /* keep cached */ }
  } else if (stale && process.env.DEPLOY_TARGET !== "cloudflare") {
    recomputeScoringInBackground(userId);
  }
  if (!base) return { matches: [], learning: { active: false, events: 0, confidence: 0 }, userSkillKeys: [] };

  // Layer 2: the mentor call is the prior, behavior is the evidence — drift a
  // rank-time COPY of the vector toward what they actually choose (±0.15 max)
  const drift: LearnedDrift | null = me ? distillSignals(inputs.signals ?? []) : null;
  const vec = applyDrift(base, drift);
  // hard requirements are pass/fail — derive what this candidate can prove,
  // then apply any facts they've pinned on the About page (the user knows)
  const quals = applyQualOverrides(
    deriveCandidateQuals({ experiences: inputs.experiences ?? [], education: inputs.education ?? [], certifications: inputs.certifications ?? [] }),
    (me?.aboutOverrides ?? null) as Parameters<typeof applyQualOverrides>[1],
  );
  // the direction agreed on the mentor call: when a call lands on a target
  // role, fillTargetTheme writes it — and the ranking should FOLLOW the call.
  const targetRole: string = (inputs.themes ?? []).find((a) => a?.kind === "target_role" && a.role && !a.pending)?.role ?? "";
  const aspireSents: string[] = (inputs.insights ?? [])
    .filter((r) => r.dimension === "aspiration" || r.dimension === "value")
    .slice(0, 3)
    .map((r) => r.content ?? "")
    .filter(Boolean);
  const targetWords = targetRole ? targetRole.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2) : [];
  const aspireWords = [...new Set(aspireSents.slice(0, 2).flatMap((s) => contentWords(s)))];
  // embed the direction ONCE per ranking (~50ms, local nomic) — on Cloudflare
  // embed() fails fast → lexical trajectory fallback (see lib/embeddings)
  const directionText = directionEmbedText(targetRole, aspireSents);
  let directionVec: number[] | null = null;
  if (directionText) { try { directionVec = (await embed([directionText]))[0] ?? null; } catch { /* fall back to lexical */ } }
  // what the résumé PROVES — the evidence half of fit
  const mySkills: string[] = (inputs.skills ?? []).map((s) => normSkill(s)).filter(Boolean);
  const pref: Preferences = (me?.preferences ?? {}) as Preferences;

  // semantic trajectory: pgvector computes the cosine distance in-DB; this tiny
  // follow-up returns (id, distance) pairs only — the 768-float vectors never
  // leave Postgres. Node-only in practice (needs the direction embedding).
  const distMap = new Map<string, number>();
  if (directionVec && (inputs.pool ?? []).length) {
    try {
      const lit = `[${directionVec.join(",")}]`;
      const ids = inputs.pool.map((p) => p.id);
      const rows = (await db.execute(
        sql`SELECT id, (embedding_vec <=> ${lit}::vector)::float8 AS d FROM opportunities WHERE id = ANY(${ids}::uuid[]) AND embedding_vec IS NOT NULL`,
      )) as unknown as { id: string; d: number }[];
      for (const r of rows) distMap.set(r.id, r.d);
    } catch { /* lexical fallback */ }
  }

  // "Not for me" is a promise: dismissed roles never rank again for this user.
  // Curated fixtures are a FALLBACK, not content: the moment real ATS-fetched
  // roles exist, only real ones are ranked.
  const dismissed = new Set(inputs.dismissed ?? []);
  const undismissed = (inputs.pool ?? []).filter((r) => !dismissed.has(r.id));
  const real = undismissed.filter((r) => r.source !== "sample");
  const roles = (real.length ? real : undismissed).map((r) => ({ ...r, trajDist: distMap.get(r.id) ?? null }));
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
      // stated locations are a FILTER, like credentials: a role somewhere they
      // wouldn't take a job doesn't rank at 82% strength — it doesn't rank
      if (l.exclude) return null;
      // evidence: the role's asked-for skills vs what the résumé proves
      const roleSkills = [...new Set([...(f.must_have_skills ?? []), ...(f.nice_to_have_skills ?? [])].map(normSkill).filter(Boolean))];
      const ev = skillEvidence(mySkills, (f.must_have_skills ?? []).map(normSkill).filter(Boolean), (f.nice_to_have_skills ?? []).map(normSkill).filter(Boolean));
      // trajectory: SEMANTIC when a direction is set — pgvector computed the cosine
      // DISTANCE to the direction in-DB (r.trajDist); score = trajectoryFromCosine(
      // 1 - distance). Lexical word-overlap is the fallback when there's no direction
      // or the role has no vector (trajDist null). targetHit stays lexical (for the
      // "you set this with your mentor" reason).
      const roleText = ` ${(r.title ?? "").toLowerCase()} ${(r.domain ?? "").toLowerCase()} ${(f.summary ?? "").toLowerCase()} ${roleSkills.join(" ")} `;
      const trajDist = (r as { trajDist?: number | null }).trajDist;
      let traj: { score: number | null; targetHit: number };
      if (directionVec && trajDist != null) {
        traj = {
          score: trajectoryFromCosine(1 - Number(trajDist)),
          targetHit: targetWords.length ? targetWords.filter((w) => roleText.includes(w)).length / targetWords.length : 0,
        };
      } else {
        traj = trajectoryFit(roleText, targetWords, aspireWords);
      }
      // fit = gate × blend(desire, evidence, trajectory) × concrete refinements.
      // blendCore renormalizes when a component is null, so missing data never
      // silently counts as a good (or bad) score. Weights live in blend.ts, the
      // single source the offline harnesses import too.
      const core = blendCore(m.desire, ev.evidence, traj.score);
      // skill-tilted breadth: for juniors, damp roles irrelevant on BOTH skills
      // and trajectory (their gate is too permissive to do it). No-op for seniors.
      const rel = relevanceDamp(vec.seniority?.score ?? 0.5, ev.evidence, traj.score);
      const fit = Math.min(1, m.gate * core * rel * c.factor * l.factor * (gate.marginal?.penalty ?? 1));
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
        minYears: f.min_years_experience ?? null, // dropped company_stage (both models just guess a house default)
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
    userSkillKeys: mySkills,
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
