/**
 * Agent — scores a person across the profile vector from their résumé facts and
 * mentor-call insights. Runs on the big model. Honest about uncertainty: thin
 * evidence → conservative score + a rationale that says so. Pure; caller decides
 * whether to persist.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { scoringVector, type ScoringVector } from "@/lib/scoring/schema";

const SCHEMA_NAME = "score_profile";

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(scoringVector, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}

const PROMPT = `Score this person across the parameters below, each 0.0–1.0, using their résumé and what the mentor has learned. This is an early, iterative model — where evidence is thin, estimate conservatively and SAY SO in the rationale. Never invent conviction the profile doesn't support.

Parameters (0 = low/left end, 1 = high/right end):
- seniority (entry → executive)
- leadership_inclination (individual contributor → wants & able to lead people)
- technical_depth
- breadth (deep specialist → broad generalist)
- builder_energy (energized by making/shipping)
- people_energy (energized by leading/mentoring others)
- autonomy_need (fine with structure → needs to run their own show)
- impact_drive (comfortable with incremental → needs to move the needle)
- comp_priority (comp is one factor → comp drives the decision)
- risk_tolerance (wants stability → embraces startup risk)
- growth_vs_stability (0 = stability, 1 = stretch/growth)
- pivot_appetite (0 = stay in lane, 1 = switch domains)

Each parameter: a score and a one-line rationale citing the specific evidence (or noting its absence).

Profile:
---
`;

export const profileScorer: Agent<{ profileText: string }, ScoringVector> = {
  name: "profile-scorer",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: SCHEMA_NAME,
      jsonSchema: jsonSchema(),
      prompt: PROMPT + input.profileText,
      maxTokens: 2000,
    });
    return { output: scoringVector.parse(res.data), usage: res.usage };
  },
};
