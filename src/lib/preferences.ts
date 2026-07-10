/**
 * User-stated matching refinements — concrete comp targets and where/how they
 * want to work. Distinct from the scoring VECTOR (which is inferred): these are
 * explicit knobs the user sets, folded into ranking on top of the vector fit.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";

export type CompCurrency = "INR" | "USD" | "GBP" | "EUR";

export type Preferences = {
  currentComp?: number; // legacy — superseded by acceptMin (kept for old rows)
  acceptMin?: number; // the floor they'd accept, annual, in compCurrency
  expectedComp?: number; // the target
  compCurrency?: CompCurrency;
  /** where they'd actually take a job — acts as a FILTER: non-remote roles
   *  outside these (and outside dreamCities) don't rank at all */
  locations?: string[];
  /** aspirational cities — roles here get a ranking BOOST on top of passing
   *  the filter ("optimise for", not "restrict to") */
  dreamCities?: string[];
  remote?: "remote" | "hybrid" | "onsite" | "any";
};

export async function getPreferences(userId: string): Promise<Preferences> {
  const [p] = await db
    .select({ preferences: profiles.preferences })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return (p?.preferences ?? {}) as Preferences;
}

export async function savePreferences(userId: string, prefs: Preferences): Promise<Preferences> {
  // normalize: drop empties, clamp comp to sane bounds, tidy locations
  const clean: Preferences = {};
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : undefined);
  clean.currentComp = n(prefs.currentComp);
  clean.acceptMin = n(prefs.acceptMin);
  clean.expectedComp = n(prefs.expectedComp);
  // the floor can't sit above the target
  if (clean.acceptMin && clean.expectedComp && clean.acceptMin > clean.expectedComp) clean.acceptMin = clean.expectedComp;
  if (prefs.compCurrency && ["INR", "USD", "GBP", "EUR"].includes(prefs.compCurrency)) clean.compCurrency = prefs.compCurrency;
  if (Array.isArray(prefs.locations)) {
    const locs = prefs.locations.map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
    if (locs.length) clean.locations = locs;
  }
  if (Array.isArray(prefs.dreamCities)) {
    const dreams = prefs.dreamCities.map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
    if (dreams.length) clean.dreamCities = dreams;
  }
  if (prefs.remote && ["remote", "hybrid", "onsite", "any"].includes(prefs.remote)) clean.remote = prefs.remote;
  await db
    .update(profiles)
    .set({ preferences: clean, updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return clean;
}
