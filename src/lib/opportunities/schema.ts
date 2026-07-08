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
  remote: z.enum(["onsite", "hybrid", "remote", "unknown"]).default("unknown"),
  comp_min: z.number().nullable().default(null), // annual, in the JD's currency if stated
  comp_max: z.number().nullable().default(null),
  // ISO code ("USD"/"INR"/"GBP"/"EUR") when the JD makes it clear — a raw number
  // can't distinguish ₹35,00,000 from $350,000, so display needs this
  comp_currency: z.string().nullable().default(null),
  company_stage: z.enum(["startup", "growth", "enterprise", "unknown"]).default("unknown"),
  domain: z.string().default(""),
  // a comprehensible plain-English read of the role — what the person would
  // actually DO day to day. Written for a candidate skimming a card, not a
  // truncated slice of the raw JD.
  summary: z.string().default(""),
  // 3-6 concrete requirements a candidate would check themselves against
  // (skills, years of experience, domain knowledge) — NOT vague adjectives.
  core_requirements: z.array(z.string()).default([]),
  must_have_skills: z.array(z.string()).default([]),
  nice_to_have_skills: z.array(z.string()).default([]),
});

export const opportunityExtraction = z.object({
  facts: opportunityFacts,
  vector: opportunityVector,
});

export type OpportunityVector = z.infer<typeof opportunityVector>;
export type OpportunityFacts = z.infer<typeof opportunityFacts>;
export type OpportunityExtraction = z.infer<typeof opportunityExtraction>;
