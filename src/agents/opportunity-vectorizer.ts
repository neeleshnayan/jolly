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

/** Bump when VECTORIZE_PROMPT changes meaning (rubric anchors, new fields, …).
 *  Stamped into facts.prompt_v at write time; the admin backfill redoes any row
 *  whose stamp is older, so a prompt change sweeps the pool exactly once.
 *  v2 (2026-07-10): anchored off_impact / off_growth / req_breadth rubrics +
 *  full-range instruction — gemma3 was centering those axes (std ≤ 0.06).
 *  v3 (2026-07-10): raised the needs_review bar to "likely WRONG", not "vague" —
 *  under v2 gemma self-flagged nearly every row (unstated years, unclear hybrid),
 *  escalating everything to itself and stalling the sweep.
 *  v4 (2026-07-11): anchored req_technical_depth to the WORK not the title — it
 *  was under-scored for junior eng roles (New Grad SWE at 0.4), so the gate
 *  couldn't separate a non-technical person from entry-level engineering.
 *  v5 (2026-07-11): two failures from the v4 batch audit (tools/v4-audit.ts):
 *  (a) tech_depth OVER-scored on tool-touching GTM/legal/design roles (Brand
 *  Designer 0.7, Commercial Counsel 0.6 — mentions of AI/SQL/dashboards raised
 *  the bar), which wrongly gates non-technical candidates out of their own
 *  roles; (b) hourly/weekly/monthly pay stored raw ($24/hr → comp_max 24),
 *  which reads as below every comp floor — comp must be ANNUALIZED.
 *  v6 (2026-07-11): the v5 batch audit found the reconcileTechDepth guard was
 *  one-directional — it CAPPED over-scored non-tech roles but never FLOORED an
 *  under-scored real engineer (Software Engineer, Full Stack came back 0.35).
 *  The guard is now symmetric (floor BUILD titles at 0.6). Pipeline change, so
 *  the stamp bumps to re-crunch every row through the same guard. */
export const VECTORIZE_PROMPT_VERSION = 6;

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
- country: the country of the ROLE'S LOCATION — NOT the company's home country.
  A US company's Zürich office is in Switzerland; a UK firm's Bangalore team is in
  India. You already know which country every city/region belongs to — infer it
  directly from the LOCATION field (Zürich→Switzerland, Bangalore→India,
  Paris→France, "New York, NY"→United States, Dubai→United Arab Emirates). Full
  country name; "Remote" only if the JD truly gives no geographic location.
- comp_min / comp_max: ANNUAL amounts, only if the JD states pay; else null.
  If the JD gives hourly/weekly/monthly pay, ANNUALIZE it (hourly ×2080,
  weekly ×52, monthly ×12): "$24–26/hour" → 49920–54080; "$3,850/week" →
  200200–200200. Never store a raw hourly or weekly number.
- comp_currency: ISO code ("USD","INR","GBP","EUR","SGD"…) for the comp range.
  Use the JD's explicit symbol/words if given; otherwise INFER from the location's
  market — you know a Bangalore salary is INR, London GBP, Berlin EUR, SF USD.
  Null ONLY when no comp range is stated at all.
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
- needs_review: TRUE only when your extraction is likely WRONG — the posting
  bundles MULTIPLE distinct roles, it isn't in English, or you had to INVENT core
  content (title, skills, summary) because the text doesn't state it. Ordinary JD
  vagueness is NORMAL and is NOT review-worthy: unstated years → null, unclear
  hybrid policy → "unknown", missing comp → null — those fields have honest
  escape values, use them and set FALSE. Most postings are FALSE. When TRUE,
  give review_reason in 3-6 words (e.g. "multiple roles in one posting").
- must_have_skills / nice_to_have_skills: concrete skills, tools, languages,
  frameworks, methodologies. Use each name's CANONICAL capitalization (TypeScript,
  Next.js, PostgreSQL, Kubernetes, React, dbt, gRPC) — this text goes straight
  onto a candidate's résumé, so "typescript" or "NEXTJS" reads wrong. Each entry is
  ONE atomic skill — a short NOUN naming a tool/tech/discipline, 1-4 words. GOOD:
  "Distributed Systems", "BGP", "RAG", "Product Marketing", "Securities Law",
  "Kubernetes". BAD, never emit: full sentences ("experience building multi-sided
  platforms at enterprise scale"), personality traits ("willingness to pick up
  slack", "bias towards impact", "concern for societal impact"), duration ("5+ years
  experience"), degrees ("Bachelor's degree"). If a bullet is a responsibility or a
  trait, extract the SKILL it implies — not the sentence. Duration/degrees live in
  min_years_experience / required_credentials.

VECTOR — what the role REQUIRES (0 = low/left, 1 = high/right):
- req_seniority (entry → executive level the role needs)
- req_leadership (IC role → heavy people-leadership) — judge by DIRECT REPORTS, not title prestige. A "founding engineer", "staff", or "principal" IC with no reports is LOW here (~0.1–0.3), even though it's senior. Only score high when the JD asks the person to manage/hire a team. Seniority ≠ leadership.
- req_technical_depth — the technical BAR to DO the work, INDEPENDENT of
  seniority. Do NOT lower it for junior/new-grad roles: a new-grad Software or
  ML Engineer still writes real production code → HIGH (0.7–0.9). Anchor by the
  WORK, not the title: software/ML/data/infra/security engineering, quantitative
  research → 0.7–0.9; technical-adjacent (solutions/sales engineer, technical PM,
  data analyst) → 0.4–0.6; sales/marketing/content/ops/recruiting/legal/design →
  0.1–0.3. USING software (SEO/CRM/analytics dashboards/design or marketing
  tools) is NOT technical depth — depth = BUILDING software/systems or
  quantitative/scientific rigor. A Content Marketer with "analytics & SEO" is
  still 0.2. "New Grad"/"Associate" lowers req_seniority, NOT req_technical_depth.
  Do NOT raise the score because the JD name-drops AI, SQL, data, dashboards, or
  automation — a role stays in ITS OWN band no matter how tech-flavored the
  company: Commercial Counsel supporting a sales org → 0.2; Brand Designer → 0.2;
  Director of Growth Marketing who "lives in SQL" → 0.3; Sales Strategy &
  Planning Manager → 0.3; a "GTM/Marketing Ops Engineer" configuring automations
  is technical-ADJACENT → 0.4–0.6, not 0.7+.
- req_breadth — 0.15 = deep specialist in one system/domain (compiler engineer,
  tax counsel, one-model researcher); 0.5 = owns a lane plus its adjacencies; 0.9 =
  true cross-functional generalist (founding engineer, chief of staff). Commit to
  an end — most roles are NOT 0.6.

VECTOR — what the role OFFERS (each score is the role's LEVEL on that axis, NOT whether it's good — 0 = the left end, 1 = the right end).
USE THE FULL 0–1 RANGE and COMMIT: if your scores for a role cluster within ±0.1 of each other, you are describing, not judging. Different axes of the same role usually differ a lot.
- off_building (0 = little hands-on building → 1 = building from scratch is the job)
- off_people_leadership (0 = no reports → 1 = leads/mentors a team) — same rule as req_leadership: a founding/staff IC with no direct reports is LOW even if the title sounds senior; score by actual team ownership, not prestige
- off_autonomy (0 = tightly scoped tickets → 1 = you run your own show)
- off_impact — the STRUCTURAL scope of this role, not the company's mission. Job
  ads overstate impact; discount the marketing. 0.3 = executes a piece of someone
  else's plan; 0.5–0.6 = owns one area's outcomes (a typical staff IC on a large
  team is here); 0.9 = owns a number the whole company watches. Most roles are
  NOT above 0.7.
- off_comp_level (0 = below market → 1 = clearly top of market)
- off_company_risk (0 = rock-solid established company → 1 = high-risk early startup that could fold; a seed-stage startup is ~0.9)
- off_growth — how much the ROLE ITSELF will stretch and change. 0.2 = steady-state
  BAU at a mature org (maintain, operate, iterate); 0.5 = normal product-team pace;
  0.9 = scaling chaos — scope doubling yearly, org being built around you. A big
  tech company shipping features is 0.4–0.6, NOT 0.7+; "fast-paced" in the ad is
  not evidence.
- off_domain_novelty (0 = standard next step for a typical candidate → 1 = a real domain pivot)

Each vector axis: a score and a one-line rationale citing the JD (or noting its silence).

Job description:
---
`;

// Vectorisation runs on a BIG context window (num_ctx below) so full JDs fit —
// this is a per-JD batch job with the GPU to itself, not the latency-sensitive
// voice path (which keeps the small default). The JD cap is now just a backstop
// against a pathological outlier, not the every-JD limiter it was at num_ctx 8192.
const VECTORIZE_NUM_CTX = Number(process.env.OLLAMA_VECTORIZE_NUM_CTX ?? 16384);
const JD_CHARS = Number(process.env.OLLAMA_VECTORIZE_JD_CHARS ?? 16000);

export const opportunityVectorizer: Agent<{ jd: string }, OpportunityExtraction> = {
  name: "opportunity-vectorizer",
  async run(input) {
    const jd = input.jd.slice(0, JD_CHARS);
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
          prompt: VECTORIZE_PROMPT + jd,
          numCtx: VECTORIZE_NUM_CTX, // big window so full JDs never truncate
          maxTokens: 4500, // 12-axis vector + rationales + facts truncated at 3000 on rich JDs
        });
        return { output: opportunityExtraction.parse(res.data), usage: res.usage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
