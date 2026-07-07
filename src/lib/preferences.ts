/**
 * User-stated matching refinements — concrete comp targets and where/how they
 * want to work. Distinct from the scoring VECTOR (which is inferred): these are
 * explicit knobs the user sets, folded into ranking on top of the vector fit.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";

export type Preferences = {
  currentComp?: number;
  expectedComp?: number;
  locations?: string[];
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
  clean.expectedComp = n(prefs.expectedComp);
  if (Array.isArray(prefs.locations)) {
    const locs = prefs.locations.map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
    if (locs.length) clean.locations = locs;
  }
  if (prefs.remote && ["remote", "hybrid", "onsite", "any"].includes(prefs.remote)) clean.remote = prefs.remote;
  await db
    .update(profiles)
    .set({ preferences: clean, updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return clean;
}
