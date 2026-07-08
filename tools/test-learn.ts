/**
 * Sanity harness for the Layer-2 learner (pure math, no DB).
 *   npx tsx tools/test-learn.ts
 * Simulates a user who applies to builder-heavy/autonomous roles and dismisses
 * people-leadership roles, then checks the drift points the right way and the
 * caps hold.
 */
import { distillSignals, applyDrift } from "@/lib/opportunities/learn";
import type { ScoringVector } from "@/lib/scoring/schema";

const role = (building: number, people: number, autonomy: number) => ({
  off_building: { score: building, rationale: "" },
  off_people_leadership: { score: people, rationale: "" },
  off_autonomy: { score: autonomy, rationale: "" },
});

const rows = [
  { kind: "applied", vector: role(0.95, 0.2, 0.9) },
  { kind: "applied", vector: role(0.9, 0.25, 0.85) },
  { kind: "apply_click", vector: role(0.85, 0.3, 0.8) },
  { kind: "dismiss", vector: role(0.2, 0.9, 0.3) },
  { kind: "dismiss", vector: role(0.25, 0.85, 0.35) },
  { kind: "impression", vector: role(0.5, 0.5, 0.5) }, // must be ignored
];

const drift = distillSignals(rows);
if (!drift) throw new Error("FAIL: drift is null");
console.log("drift:", JSON.stringify(drift, null, 2));

const assert = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`ok: ${name}`);
};

assert("builder delta positive (applied to builder roles)", (drift.deltas.builder_energy ?? 0) > 0.02);
assert("people delta negative (dismissed people roles)", (drift.deltas.people_energy ?? 0) < -0.02);
assert("autonomy delta positive", (drift.deltas.autonomy_need ?? 0) > 0.02);
assert("confidence in (0,1]", drift.confidence > 0 && drift.confidence <= 1);
assert("every delta within ±0.15 cap", Object.values(drift.deltas).every((d) => Math.abs(d!) <= 0.15));
assert("impressions ignored (5 weighted events → conf 4.1/6)", Math.abs(drift.confidence - (1 + 1 + 0.5 + 0.8 + 0.8) / 6) < 1e-9);

const vec = { builder_energy: { score: 0.9, rationale: "x" }, people_energy: { score: 0.4, rationale: "x" }, autonomy_need: { score: 0.97, rationale: "x" } } as unknown as ScoringVector;
const out = applyDrift(vec, drift) as unknown as Record<string, { score: number }>;
assert("drifted builder ≤ 1 (clamped)", out.builder_energy.score <= 1 && out.builder_energy.score > 0.9);
assert("drifted people moved down", out.people_energy.score < 0.4);
assert("original vector untouched", (vec as unknown as Record<string, { score: number }>).builder_energy.score === 0.9);

// no-signal and dismiss-only cases
assert("empty rows → null", distillSignals([]) === null);
assert("impressions only → null", distillSignals([{ kind: "impression", vector: role(0.9, 0.9, 0.9) }]) === null);

console.log("\nall assertions passed ✓");
