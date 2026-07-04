/**
 * Agent — reads a job description and produces (a) hard facts for filtering and
 * (b) the role vector in the candidate's scoring space. Same shape/pattern as
 * profile-scorer, pointed at a JD instead of a résumé. Honest about uncertainty:
 * infer conservatively where the JD is vague and say so in the rationale.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { opportunityExtraction, type OpportunityExtraction } from "@/lib/opportunities/schema";

const SCHEMA_NAME = "vectorize_role";

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(opportunityExtraction, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}

const PROMPT = `Read this job description and produce two things: hard FACTS (for filtering) and a role VECTOR scored 0.0–1.0 on each axis. Where the JD is vague, infer conservatively and SAY SO in the rationale — never invent specifics.

FACTS:
- title, company, location, remote (onsite/hybrid/remote/unknown)
- comp_min / comp_max (only if the JD states a range; else null)
- company_stage (startup/growth/enterprise/unknown — infer from the company & language)
- domain (e.g. "fintech backend", "AI infra", "growth marketing")
- must_have_skills / nice_to_have_skills

VECTOR — what the role REQUIRES (0 = low/left, 1 = high/right):
- req_seniority (entry → executive level the role needs)
- req_leadership (IC role → heavy people-leadership)
- req_technical_depth
- req_breadth (deep specialist → broad generalist)

VECTOR — what the role OFFERS (each score is the role's LEVEL on that axis, NOT whether it's good — 0 = the left end, 1 = the right end):
- off_building (0 = little hands-on building → 1 = building from scratch is the job)
- off_people_leadership (0 = no reports → 1 = leads/mentors a team)
- off_autonomy (0 = tightly scoped tickets → 1 = you run your own show)
- off_impact (0 = incremental → 1 = moves the needle)
- off_comp_level (0 = below market → 1 = clearly top of market)
- off_company_risk (0 = rock-solid established company → 1 = high-risk early startup that could fold; a seed-stage startup is ~0.9)
- off_growth (0 = steady-state → 1 = fast growth / stretch)
- off_domain_novelty (0 = standard next step for a typical candidate → 1 = a real domain pivot)

Each vector axis: a score and a one-line rationale citing the JD (or noting its silence).

Job description:
---
`;

export const opportunityVectorizer: Agent<{ jd: string }, OpportunityExtraction> = {
  name: "opportunity-vectorizer",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: SCHEMA_NAME,
      jsonSchema: jsonSchema(),
      prompt: PROMPT + input.jd,
      maxTokens: 2500,
    });
    return { output: opportunityExtraction.parse(res.data), usage: res.usage };
  },
};
