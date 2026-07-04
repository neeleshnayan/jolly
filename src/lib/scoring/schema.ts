import { z } from "zod";
import { confidence01 } from "@/lib/insights/schema";

/**
 * A first-pass, deliberately-simple scoring vector: a flat set of 0–1 parameters
 * with a one-line rationale each. This is the profile→opportunity bridge — decent
 * now, meant to be tuned against live users. Grouped by axis for readability.
 */
const param = z.object({
  score: confidence01, // 0–1 (tolerant clamp)
  rationale: z.string().default(""),
});

export const scoringVector = z.object({
  // capability — what they can do
  seniority: param, // entry → executive
  leadership_inclination: param, // IC → wants & able to lead people
  technical_depth: param,
  breadth: param, // specialist → generalist
  // motivation — what drives them
  builder_energy: param, // energized by making/shipping
  people_energy: param, // energized by leading/mentoring
  autonomy_need: param,
  impact_drive: param,
  // filters / trajectory — what they'll say yes to
  comp_priority: param, // how much comp drives decisions
  risk_tolerance: param, // stability → startup risk
  growth_vs_stability: param, // 0 = stability, 1 = stretch/growth
  pivot_appetite: param, // 0 = stay in lane, 1 = switch domains
});

export type ScoringVector = z.infer<typeof scoringVector>;
export const SCORING_PARAMS = Object.keys(scoringVector.shape) as (keyof ScoringVector)[];
