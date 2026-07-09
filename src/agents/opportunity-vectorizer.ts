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

// exported so the model bake-off tool runs the EXACT production extraction
export function vectorizeJsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(opportunityExtraction, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}

export const VECTORIZE_PROMPT = `Read this job description and produce two things: hard FACTS (for filtering) and a role VECTOR scored 0.0–1.0 on each axis. Where the JD is vague, infer conservatively and SAY SO in the rationale — never invent specifics.

FACTS:
- title, company, location, remote (onsite/hybrid/remote/unknown)
- country: the country this role sits in, inferred from the location ("Bangalore"
  → "India", "SF" / "New York, NY" → "United States", "London" → "United Kingdom").
  Full country name. If fully remote with no country signal, or genuinely unclear,
  null — never guess.
- comp_min / comp_max (only if the JD states a range; else null)
- comp_currency: ISO code of that range ("USD","INR","GBP","EUR") if the JD or
  its location makes it clear; else null. Never guess a symbol from habit.
- min_years_experience: the years REQUIRED (e.g. "8+ years" → 8); null if not
  stated. Use the overall/headline requirement, not per-skill sub-requirements.
- required_credentials: degrees/licenses the JD makes MANDATORY, normalized to
  exactly one of: "phd","md","jd","mba","masters","bachelors","associate"
  (degrees — md covers MBBS, jd covers LLB) or "cpa","ca","cfa","frm","cfp",
  "bar","rn","pe","pmp" (licenses — bar = admitted to practice law, rn =
  nursing licensure, pe = professional engineer). "PhD preferred", "a plus",
  or "or equivalent experience" do NOT count — required means the screen
  would reject without it. Requirements hide in prose ("you should have…",
  "candidates must hold…", "membership in good standing") — read for meaning,
  not just the word "required". Examples:
    "BA required, MS or PhD preferred"                    → ["bachelors"]
    "must have a J.D. and be a member of a state bar"     → ["jd","bar"]
    "CPA or CA designation required"                      → []  (an either/or — don't gate)
    "PhD in ML or equivalent industry experience"         → []
  Every listed credential must be INDIVIDUALLY mandatory (they combine as AND).
- company_stage (startup/growth/enterprise/unknown — infer from the company & language)
- domain (e.g. "fintech backend", "AI infra", "growth marketing")
- summary: 2-3 plain-English sentences on what the person would actually DO day
  to day in this role. Write it for someone skimming a job card who has NOT read
  the JD — concrete and specific (what they'd build/own/lead), not marketing
  fluff ("fast-paced", "rockstar", "make an impact"). No restating the title.
- core_requirements: 3-6 short, concrete bullets a candidate could check
  themselves against (e.g. "5+ years backend Go/Java", "has shipped a
  consumer product 0-to-1", "comfortable owning on-call for a service").
  Concrete and checkable — never vague adjectives like "strong communicator".
- must_have_skills / nice_to_have_skills

VECTOR — what the role REQUIRES (0 = low/left, 1 = high/right):
- req_seniority (entry → executive level the role needs)
- req_leadership (IC role → heavy people-leadership) — judge by DIRECT REPORTS, not title prestige. A "founding engineer", "staff", or "principal" IC with no reports is LOW here (~0.1–0.3), even though it's senior. Only score high when the JD asks the person to manage/hire a team. Seniority ≠ leadership.
- req_technical_depth
- req_breadth (deep specialist → broad generalist)

VECTOR — what the role OFFERS (each score is the role's LEVEL on that axis, NOT whether it's good — 0 = the left end, 1 = the right end):
- off_building (0 = little hands-on building → 1 = building from scratch is the job)
- off_people_leadership (0 = no reports → 1 = leads/mentors a team) — same rule as req_leadership: a founding/staff IC with no direct reports is LOW even if the title sounds senior; score by actual team ownership, not prestige
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
    // task-scoped so callers can pin this to Ollama (LLM_PROVIDER_VECTORIZE=ollama)
    // without touching the global LLM_PROVIDER other tasks read
    const provider = getProvider("vectorize");
    // Local models occasionally emit truncated/invalid JSON. One retry clears the
    // vast majority of those flakes before we give up on a role.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await provider.extractStructured({
          schemaName: SCHEMA_NAME,
          jsonSchema: vectorizeJsonSchema(),
          prompt: VECTORIZE_PROMPT + input.jd,
          maxTokens: 3000,
        });
        return { output: opportunityExtraction.parse(res.data), usage: res.usage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
