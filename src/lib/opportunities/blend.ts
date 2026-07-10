/**
 * The ranking blend — single source of truth for how desire, evidence and
 * trajectory combine into the core score. Extracted so the offline harnesses
 * (tools/anchors.ts, tools/match-sanity.ts) test the EXACT production formula
 * instead of a hand-copied replica that silently drifts.
 *
 * fit = gate × blendCore(desire, evidence, trajectory) × comp × location × creds
 * (the multipliers live in recommend.ts; this file owns only the three-way blend.)
 */

/** Component weights. desire is the "you'll love it" story (softest signal);
 *  evidence is résumé↔JD skill overlap; trajectory is embedding cosine to the
 *  direction the user set. Rebalanced 2026-07-11 (was 0.45/0.35/0.20): desire is
 *  the fuzziest signal (LLM-estimated on both sides), so it no longer dominates —
 *  trajectory, our strongest discipline signal, gets enough weight to reorder
 *  WITHIN a discipline, not just nudge. Verified no anchor regressed. */
export const BLEND_WEIGHTS = { desire: 0.35, evidence: 0.35, trajectory: 0.3 } as const;

/**
 * Renormalizing weighted blend of the three components. evidence and trajectory
 * may be null (role lists no skills / user set no direction) — a null component
 * drops out and the remaining weights renormalize, so missing data never silently
 * counts as good or bad. desire is always present.
 */
export function blendCore(
  desire: number,
  evidence: number | null,
  trajectory: number | null,
  w: { desire: number; evidence: number; trajectory: number } = BLEND_WEIGHTS,
): number {
  const parts: [number, number][] = [[desire, w.desire]];
  if (evidence !== null) parts.push([evidence, w.evidence]);
  if (trajectory !== null) parts.push([trajectory, w.trajectory]);
  const wsum = parts.reduce((a, [, wt]) => a + wt, 0);
  return wsum > 0 ? parts.reduce((a, [x, wt]) => a + x * wt, 0) / wsum : desire;
}
