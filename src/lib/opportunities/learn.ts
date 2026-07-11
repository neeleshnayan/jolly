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
// the drift MATH now lives in rank-core (pure, shared with the Deno ranker);
// learn.ts keeps only the DB read. Re-exported so existing importers are unaffected.
import { distillSignals, SIGNAL_KINDS, type LearnedDrift } from "./rank-core";
export { distillSignals, applyDrift, type LearnedDrift } from "./rank-core";

/** Read the signal log and distill it into a drift. Null = nothing to learn yet. */
export async function learnDrift(profileId: string): Promise<LearnedDrift | null> {
  const rows = await db
    .select({ kind: rankingSignals.kind, vector: opportunities.vector })
    .from(rankingSignals)
    .innerJoin(opportunities, eq(opportunities.id, rankingSignals.opportunityId))
    .where(and(eq(rankingSignals.profileId, profileId), inArray(rankingSignals.kind, SIGNAL_KINDS)))
    .orderBy(desc(rankingSignals.createdAt))
    .limit(200);
  return distillSignals(rows);
}
