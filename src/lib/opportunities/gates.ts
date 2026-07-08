/**
 * Hard-requirement GATES — filters, not similarity. A JD that requires a PhD
 * or 10 years is stating a pass/fail condition; no work-style alignment buys
 * it back. Gates decide whether a role appears; desire decides where it ranks.
 *
 *   credentials  → binary: missing a required degree/license = gated out
 *   years        → wiggle: within 2 years of the ask = shown with an honest
 *                  gap chip + small penalty; beyond that = gated out
 *
 * Facts come from extraction only (rows vectorized before these fields exist
 * simply don't gate — the pool gets re-vectorized once the structure is final).
 */
import type { OpportunityFacts } from "./schema";

export type Credential = "phd" | "md" | "jd" | "masters" | "bachelors";

export type CandidateQuals = {
  yearsExperience: number | null; // null = résumé has no parseable dates
  credentials: Set<Credential>;
};

export type GateResult =
  | { pass: true; marginal?: { penalty: number; gap: string } }
  | { pass: false; reason: string };

const YEARS_WIGGLE = 2;
const MARGINAL_PENALTY = 0.88; // shown, but honestly demoted

// ---- candidate side (deterministic, from the résumé) ----

/** "June 2019", "2019-06", "Jun 2019", "2019" → year (month ignored — year
 *  precision is plenty for a years-of-experience estimate). */
export function parseYear(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

export function deriveCandidateQuals(input: {
  experiences: { startDate: string | null }[];
  education: { degree: string | null; field?: string | null }[];
}): CandidateQuals {
  const startYears = input.experiences.map((e) => parseYear(e.startDate)).filter((y): y is number => y !== null);
  const yearsExperience = startYears.length ? Math.max(0, new Date().getFullYear() - Math.min(...startYears)) : null;

  const credentials = new Set<Credential>();
  for (const ed of input.education) {
    const d = (ed.degree ?? "").toLowerCase();
    if (/\bph\.?\s?d|doctor(ate|al)\b/.test(d)) credentials.add("phd");
    if (/\bm\.?d\b|doctor of medicine/.test(d)) credentials.add("md");
    if (/\bj\.?d\b|juris doctor|ll\.?b/.test(d)) credentials.add("jd");
    if (/\bmaster|m\.?b\.?a|m\.?s(c|\b)|m\.?tech|m\.?e(ng)?\b/.test(d)) credentials.add("masters");
    if (/\bbachelor|b\.?s(c|\b)|b\.?tech|b\.?e(ng)?\b|b\.?a\b|undergrad/.test(d)) credentials.add("bachelors");
  }
  return { yearsExperience, credentials };
}

// higher degrees satisfy lower requirements
const SATISFIES: Record<Credential, Credential[]> = {
  phd: ["phd"],
  md: ["md"],
  jd: ["jd"],
  masters: ["masters", "phd", "md", "jd"],
  bachelors: ["bachelors", "masters", "phd", "md", "jd"],
};

// ---- the gate ----

export function hardGate(role: { facts: Partial<OpportunityFacts> | null }, cand: CandidateQuals): GateResult {
  const f = role.facts ?? {};

  const requiredCreds = ((f.required_credentials as string[] | undefined) ?? [])
    .map((c) => c.toLowerCase().trim())
    .filter((c): c is Credential => c in SATISFIES);
  for (const req of requiredCreds) {
    if (!SATISFIES[req].some((c) => cand.credentials.has(c))) {
      return { pass: false, reason: `requires ${req === "phd" ? "a PhD" : req === "md" ? "an MD" : req === "jd" ? "a JD" : `a ${req} degree`}` };
    }
  }

  const reqYears = f.min_years_experience ?? null;
  if (reqYears !== null && cand.yearsExperience !== null) {
    const shortfall = reqYears - cand.yearsExperience;
    if (shortfall > YEARS_WIGGLE) return { pass: false, reason: `asks ${reqYears}+ yrs — you're at ${cand.yearsExperience}` };
    if (shortfall > 0) {
      return { pass: true, marginal: { penalty: MARGINAL_PENALTY, gap: `Asks ${reqYears}+ yrs — you're at ${cand.yearsExperience} (close enough to try)` } };
    }
  }
  return { pass: true };
}
