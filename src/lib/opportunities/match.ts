/**
 * Match a candidate's scoring vector against a role's opportunity vector.
 * Two halves, per the design:
 *   qualification — does their CAPABILITY meet what the role REQUIRES?
 *   desire        — do their PREFERENCES align with what the role OFFERS?
 * Desire is VALUE-WEIGHTED: axes the person feels strongly about (far from
 * neutral) dominate, so two identical résumés with different values rank
 * differently. Everything is explainable — we return the per-axis breakdown.
 */
import type { ScoringVector } from "@/lib/scoring/schema";
import type { OpportunityVector } from "@/lib/opportunities/schema";

type Axis = { key: string; label: string; user: number; role: number; weight: number; fit: number };

export interface MatchResult {
  fit: number; // 0–1 overall
  qualification: number; // 0–1
  desire: number; // 0–1
  reasons: string[]; // strongest alignments ("why it fits")
  gaps: string[]; // biggest misalignments / under-qualification
  breakdown: Axis[];
}

const s = (p?: { score: number }) => p?.score ?? 0.5;

export function scoreMatch(user: ScoringVector, opp: OpportunityVector): MatchResult {
  // ---- qualification: a GATE, not a ranker. 1 if they clear the bar; drops only
  // when under-qualified. Over-clearing an easy role is NOT rewarded. ----
  const qual: Axis[] = [
    ["seniority", s(user.seniority), s(opp.req_seniority)],
    ["leadership", s(user.leadership_inclination), s(opp.req_leadership)],
    ["technical depth", s(user.technical_depth), s(opp.req_technical_depth)],
    ["breadth", s(user.breadth), s(opp.req_breadth)],
  ].map(([label, u, r]) => ({
    key: `q_${label}`,
    label: label as string,
    user: u as number,
    role: r as number,
    weight: 1,
    fit: 1 - Math.max(0, (r as number) - (u as number)), // only under-qual counts
  }));
  const qualification = mean(qual.map((a) => a.fit));
  const gate = Math.min(1, qualification / 0.85); // comfortable clearance → ~1

  // ---- desire: the ranker. Squared deviation so a big mismatch on something
  // they care about bites hard; weighted by preference strength. ----
  const alignPairs: [string, number, number][] = [
    ["building", s(user.builder_energy), s(opp.off_building)],
    ["people leadership", s(user.people_energy), s(opp.off_people_leadership)],
    ["autonomy", s(user.autonomy_need), s(opp.off_autonomy)],
    ["impact", s(user.impact_drive), s(opp.off_impact)],
    ["risk", s(user.risk_tolerance), s(opp.off_company_risk)],
    ["growth", s(user.growth_vs_stability), s(opp.off_growth)],
    ["domain pivot", s(user.pivot_appetite), s(opp.off_domain_novelty)],
  ];
  const desireAxes: Axis[] = alignPairs.map(([label, u, r]) => ({
    key: `d_${label}`,
    label,
    user: u,
    role: r,
    weight: Math.abs(u - 0.5) * 2, // how strongly they feel
    fit: 1 - Math.abs(u - r) ** 2, // squared → strong mismatches punished
  }));
  // comp: they always want more; penalty is how far the role falls short, weighted
  // by how much they prioritise comp. High comp is never a "mismatch".
  const compLevel = s(opp.off_comp_level);
  desireAxes.push({
    key: "d_comp",
    label: "compensation",
    user: s(user.comp_priority),
    role: compLevel,
    weight: s(user.comp_priority),
    fit: 1 - (1 - compLevel) ** 2,
  });
  const desire = weightedMean(desireAxes);

  // desire ranks; qualification only gates roles they genuinely can't do
  const fit = gate * desire;

  const breakdown = [...qual, ...desireAxes];
  const scored = breakdown
    .filter((a) => a.weight > 0.15)
    .map((a) => ({ a, impact: a.weight * a.fit, miss: a.weight * (1 - a.fit) }));
  const reasons = scored
    .filter((x) => x.a.fit > 0.7)
    .sort((x, y) => y.impact - x.impact)
    .slice(0, 3)
    .map((x) => phrase(x.a, true));
  const gaps = scored
    .filter((x) => x.miss > 0.2)
    .sort((x, y) => y.miss - x.miss)
    .slice(0, 3)
    .map((x) => phrase(x.a, false));

  return { fit, qualification, desire, reasons, gaps, breakdown };
}

function phrase(a: Axis, positive: boolean): string {
  const L = cap(a.label);
  if (positive) return `${L} lines up`;
  if (a.key.startsWith("q_")) return `Stretch on ${a.label} — the role asks for more than you show`;
  if (a.key === "d_comp") return `Comp looks below where you'd want it`;
  return a.user > a.role
    ? `You want more ${a.label} than this offers`
    : `More ${a.label} here than you're after`;
}
const cap = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function weightedMean(axes: Axis[]): number {
  const w = axes.reduce((a, x) => a + x.weight, 0);
  return w > 0 ? axes.reduce((a, x) => a + x.weight * x.fit, 0) / w : 0.5;
}
