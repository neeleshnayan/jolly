import { z } from "zod";
import { confidence01 } from "@/lib/insights/schema";

/**
 * The role, in the SAME space as the user's scoring vector so matching is a clean
 * per-axis comparison. Split two ways, per the design:
 *   requires → matched against the candidate's CAPABILITY  ("can they do it?")
 *   offers   → matched against the candidate's MOTIVATIONS  ("will they want it?")
 * Plus hard `facts` used to FILTER before we ever score fit.
 */
const param = z.object({
  score: confidence01, // 0–1 (tolerant clamp)
  rationale: z.string().default(""),
});

export const opportunityVector = z.object({
  // what the role REQUIRES  ↔  user capability
  req_seniority: param, // entry → executive level needed
  req_leadership: param, // how much people-leadership it demands
  req_technical_depth: param,
  req_breadth: param, // specialist role → generalist role
  // what the role OFFERS  ↔  user motivations / values
  off_building: param, // hands-on building intensity
  off_people_leadership: param, // leading/mentoring others
  off_autonomy: param, // independence granted
  off_impact: param, // scope of impact
  off_comp_level: param, // comp signal relative to market
  off_company_risk: param, // startup risk / stage
  off_growth: param, // growth/stretch vs steady
  off_domain_novelty: param, // how much of a domain pivot for a typical candidate
});

export const opportunityFacts = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  location: z.string().nullable().default(null),
  // country the role sits in, inferred from location ("Bangalore" → "India").
  // REQUIRED (no default) on purpose: a defaulted/nullable field is OPTIONAL in
  // the JSON schema, so the model just omits it (it fills currency from the same
  // location, so it clearly knows the country — it was taking the escape hatch).
  // Required → Ollama's schema-constrained generation must emit it.
  country: z.string(),
  // REQUIRED (no default) for the same reason as country: a defaulted field is
  // OPTIONAL in the JSON schema, so small models (granite) silently omit it and it
  // falls back to "unknown" — the card's Work-style cell was empty on ~100% of
  // roles even though most JDs state the arrangement. Required → the grammar must
  // pick one of the four, so real onsite/hybrid/remote values actually land.
  remote: z.enum(["onsite", "hybrid", "remote", "unknown"]),
  // nullable but NOT defaulted: the KEY is required (model must actively decide
  // "is a comp range stated? number : null") instead of skipping it when present.
  comp_min: z.number().nullable(), // annual, in the JD's currency if stated
  comp_max: z.number().nullable(),
  // ISO code ("USD"/"INR"/"GBP"/"EUR") when the JD makes it clear — a raw number
  // can't distinguish ₹35,00,000 from $350,000, so display needs this
  comp_currency: z.string().nullable(),
  // hard requirements — FILTERS, not similarity axes. Only what the JD states
  // as REQUIRED ("PhD preferred" or "or equivalent experience" must NOT land
  // here). Credentials normalized: "phd" | "md" | "jd" | "masters" | "bachelors"
  // required-nullable (no default): now shown on the card as "N+ yrs", so the model
  // must actively decide "does the JD state a years requirement? number : null"
  // rather than skipping the key and defaulting to null on JDs that DO state it.
  min_years_experience: z.number().nullable(),
  required_credentials: z.array(z.string()).default([]),
  // required (no default) — same lever: optional → granite skips it (was populated
  // on only ~7% of roles). Forcing the key makes the model actually infer the stage.
  company_stage: z.enum(["startup", "growth", "enterprise", "unknown"]),
  domain: z.string().default(""),
  // a comprehensible plain-English read of the role — what the person would
  // actually DO day to day. Written for a candidate skimming a card, not a
  // truncated slice of the raw JD. REQUIRED (min length) so small models can't
  // skip it the way they skip optional fields — the card would be blank.
  summary: z.string().min(40),
  // 3-6 concrete requirements a candidate would check themselves against
  // (skills, years of experience, domain knowledge) — NOT vague adjectives.
  core_requirements: z.array(z.string()).default([]),
  // REQUIRED, min 3: a defaulted array is optional in the JSON schema, so smaller
  // models (granite) skip it and emit []. minItems forces the grammar to produce
  // real skills — the same lever that made country reliable. Every real role has
  // skills; this stops the "good summary, empty skills" failure.
  must_have_skills: z.array(z.string()).min(3),
  nice_to_have_skills: z.array(z.string()).default([]),
  // the fast model's OWN read of whether it struggled — set true when the JD was
  // genuinely hard to extract cleanly (bundles multiple roles, key fields guessed,
  // dense/ambiguous, non-English). The tiered pass escalates on this OR the
  // objective checks, so an overconfident "false" can't hide a real miss, but a
  // grounded "true" catches wrong-but-present output the heuristics can't see.
  // Required (no default) so the model must actually decide rather than skip it.
  needs_review: z.boolean(),
  review_reason: z.string().default(""), // 3-6 words when needs_review is true
});

export const opportunityExtraction = z.object({
  facts: opportunityFacts,
  vector: opportunityVector,
});

export type OpportunityVector = z.infer<typeof opportunityVector>;
export type OpportunityFacts = z.infer<typeof opportunityFacts>;
export type OpportunityExtraction = z.infer<typeof opportunityExtraction>;
