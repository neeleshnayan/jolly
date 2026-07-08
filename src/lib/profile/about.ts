/**
 * About-me facts: employer, years of experience, highest degree, trajectory.
 * Derived from the résumé by default; the user can PIN precise values
 * (about_overrides on profiles) and pinned values win everywhere — display
 * and the ranking gates. Derivation guesses; the user knows.
 */
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { education, experiences, profiles } from "@/db/schema";
import { deriveCandidateQuals, DEGREES, type CandidateQuals, type Credential, type Degree } from "@/lib/opportunities/gates";

export type AboutOverrides = {
  yearsExperience?: number;
  highestDegree?: Degree | "none"; // licenses (CPA, bar…) come from certifications, not this pin
  currentEmployer?: string;
  trajectory?: string;
};

export type AboutFacts = {
  currentEmployer: { value: string | null; pinned: boolean };
  yearsExperience: { value: number | null; pinned: boolean };
  highestDegree: { value: Degree | "none" | null; pinned: boolean };
  trajectory: { value: string | null; pinned: boolean };
};

// highest-first display order (SATISFIES in gates.ts already encodes what a
// degree unlocks; this list only picks which one to SHOW)
const DEGREE_ORDER: (Degree | "none")[] = ["phd", "md", "jd", "mba", "masters", "bachelors", "associate", "none"];
export const highestOf = (creds: Set<Credential>): Degree | "none" =>
  DEGREE_ORDER.find((d): d is Degree => d !== "none" && creds.has(d)) ?? "none";

/** The quals the ranking gates should use: derivation with pins applied.
 *  A pinned degree replaces the DEGREES only — licenses (CPA, bar, RN…) come
 *  from the certifications rail and survive the pin. */
export function applyQualOverrides(derived: CandidateQuals, o: AboutOverrides | null): CandidateQuals {
  if (!o) return derived;
  let credentials = derived.credentials;
  if (o.highestDegree !== undefined) {
    credentials = new Set([...derived.credentials].filter((c) => !(DEGREES as readonly string[]).includes(c)));
    if (o.highestDegree !== "none") credentials.add(o.highestDegree);
  }
  return {
    yearsExperience: o.yearsExperience ?? derived.yearsExperience,
    credentials,
  };
}

export async function getAboutFacts(userId: string): Promise<AboutFacts | null> {
  const [p] = await db
    .select({ id: profiles.id, headline: profiles.headline, aboutOverrides: profiles.aboutOverrides })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!p) return null;
  const o = (p.aboutOverrides ?? {}) as AboutOverrides;

  const exps = await db
    .select({ title: experiences.title, org: experiences.org, isCurrent: experiences.isCurrent, startDate: experiences.startDate, createdAt: experiences.createdAt, position: experiences.position })
    .from(experiences)
    .where(eq(experiences.profileId, p.id))
    .orderBy(asc(experiences.position), desc(experiences.createdAt));
  const edu = await db.select({ degree: education.degree }).from(education).where(eq(education.profileId, p.id));

  const quals = deriveCandidateQuals({ experiences: exps, education: edu });
  const current = exps.find((e) => e.isCurrent) ?? exps[0];
  // résumé display order (position asc) = newest first; reversed reads as a career
  const chrono = [...exps].reverse().map((e) => e.org).filter(Boolean);
  const arc = [...new Set(chrono)].join(" → ") || null;

  return {
    currentEmployer: { value: o.currentEmployer ?? current?.org ?? null, pinned: o.currentEmployer !== undefined },
    yearsExperience: { value: o.yearsExperience ?? quals.yearsExperience, pinned: o.yearsExperience !== undefined },
    highestDegree: { value: o.highestDegree ?? highestOf(quals.credentials), pinned: o.highestDegree !== undefined },
    trajectory: { value: o.trajectory ?? arc, pinned: o.trajectory !== undefined },
  };
}
