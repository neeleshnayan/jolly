/**
 * Layer 2 of ranking: learn from what the user DOES, not just what they said
 * on the mentor call. The scoring snapshot is the prior; ranking_signals
 * (applied / apply_click / dismiss) are the evidence; the output is a small,
 * confidence-scaled nudge to a RANK-TIME COPY of the user's vector.
 *
 * Deliberately NOT stored back onto the scoring snapshot: the diagnosis page
 * shows those scores with the mentor's rationale, and behavior must never
 * silently rewrite what the mentor said. The learned drift lives only in the
 * ranking (and is fully recomputable from the signal log).
 *
 * Math (deterministic, explainable):
 *   direction[axis] = Σ_e w_e · (roleAxis_e − 0.5) / Σ_e |w_e|   ∈ [−0.5, 0.5]
 *   confidence      = min(1, Σ_e |w_e| / 6)      — full strength ≈ 6 real actions
 *   u_eff[axis]     = clamp01(u[axis] + 0.3 · direction[axis] · confidence)
 * so the maximum drift on any axis is ±0.15 — behavior tunes the mentor's
 * read, it can never overturn it. Re-ranking is instant after every action.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, rankingSignals } from "@/db/schema";
import type { ScoringVector } from "@/lib/scoring/schema";
import type { OpportunityVector } from "./schema";

// how loudly each action speaks (impressions are logged but too passive to
// train on yet — a card scrolled past is not a judgment)
const EVENT_WEIGHT: Record<string, number> = {
  applied: 1.0,
  apply_click: 0.5,
  dismiss: -0.8,
};

// user-axis ↔ role-axis pairs — the same pairing scoreMatch ranks desire on
const AXIS_PAIRS: [keyof ScoringVector, keyof OpportunityVector][] = [
  ["builder_energy", "off_building"],
  ["people_energy", "off_people_leadership"],
  ["autonomy_need", "off_autonomy"],
  ["impact_drive", "off_impact"],
  ["risk_tolerance", "off_company_risk"],
  ["growth_vs_stability", "off_growth"],
  ["pivot_appetite", "off_domain_novelty"],
];

export type LearnedDrift = {
  /** per user-axis delta already scaled by confidence — add to the vector */
  deltas: Partial<Record<keyof ScoringVector, number>>;
  confidence: number; // 0–1
  events: number; // real actions consumed
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Pure math: signal rows → drift. Exported for testability. */
export function distillSignals(rows: { kind: string; vector: unknown }[]): LearnedDrift | null {
  if (!rows.length) return null;

  let totalWeight = 0;
  const sums: Record<string, number> = {};
  for (const r of rows) {
    const w = EVENT_WEIGHT[r.kind] ?? 0;
    if (!w) continue;
    const v = (r.vector ?? {}) as OpportunityVector;
    totalWeight += Math.abs(w);
    for (const [, roleAxis] of AXIS_PAIRS) {
      const score = (v[roleAxis] as { score?: number } | undefined)?.score ?? 0.5;
      sums[roleAxis] = (sums[roleAxis] ?? 0) + w * (score - 0.5);
    }
  }
  if (totalWeight === 0) return null;

  const confidence = Math.min(1, totalWeight / 6);
  const deltas: LearnedDrift["deltas"] = {};
  for (const [userAxis, roleAxis] of AXIS_PAIRS) {
    const direction = (sums[roleAxis] ?? 0) / totalWeight; // [−0.5, 0.5]
    const d = 0.3 * direction * confidence;
    if (Math.abs(d) > 0.005) deltas[userAxis] = d;
  }
  return { deltas, confidence, events: rows.length };
}

/** Read the signal log and distill it into a drift. Null = nothing to learn yet. */
export async function learnDrift(profileId: string): Promise<LearnedDrift | null> {
  const rows = await db
    .select({ kind: rankingSignals.kind, vector: opportunities.vector })
    .from(rankingSignals)
    .innerJoin(opportunities, eq(opportunities.id, rankingSignals.opportunityId))
    .where(and(eq(rankingSignals.profileId, profileId), inArray(rankingSignals.kind, Object.keys(EVENT_WEIGHT))))
    .orderBy(desc(rankingSignals.createdAt))
    .limit(200);
  return distillSignals(rows);
}

/** Apply a drift to a COPY of the scoring vector (params are {score, rationale}). */
export function applyDrift(vec: ScoringVector, drift: LearnedDrift | null): ScoringVector {
  if (!drift || !Object.keys(drift.deltas).length) return vec;
  const out = { ...vec } as Record<string, { score: number; rationale?: string }>;
  for (const [axis, delta] of Object.entries(drift.deltas)) {
    const cur = out[axis];
    if (!cur || typeof cur.score !== "number") continue;
    out[axis] = { ...cur, score: clamp01(cur.score + (delta as number)) };
  }
  return out as unknown as ScoringVector;
}
