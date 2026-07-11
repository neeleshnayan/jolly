/**
 * The SELF-UPDATING half of skill canonicalisation. The hand-curated CANON map
 * in ./canon covers the head (TypeScript, CI/CD…), but the skill universe is
 * unbounded — so for the tail we harvest display casing from the pool itself:
 * gemma is prompted to emit each skill's canonical capitalization, which makes
 * every vectorized JD a dictionary entry. Group all stored skills by canonical
 * key, and for each key adopt the most frequent variant that carries
 * intentional casing (has an uppercase char, isn't SHOUTING a phrase).
 *
 * Resolution order (displaySkillSmart):
 *   1. explicit CANON entry        — hand-curated, always wins
 *   2. learned-from-pool casing    — grows with every vectorized JD, zero upkeep
 *   3. acronym-aware title-case    — the fallback in ./canon
 *
 * ALIASES (k8s→kubernetes) stay hand-curated in ./canon: true synonyms are few,
 * high-risk to guess, and cheap to add — one line per alias.
 *
 * Cached in-memory ~10 min; rebuilding is one grouped scan of facts.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { TRUSTED_MODELS } from "@/lib/jobs/vectorize";
import { canonSkillKey, displaySkill } from "./canon";

let cache: { map: Map<string, string>; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

// intentional casing: at least one uppercase, not an ALL-CAPS multiword shout
const looksIntentional = (s: string) => /[A-Z]/.test(s) && !(s === s.toUpperCase() && s.includes(" "));

export async function getLearnedSkillCasing(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map<string, string>();
  try {
    // only trusted-model rows vote — granite-era rows would elect lowercase
    const rows = (await db.execute(sql`
      select s.skill, count(*)::int as n
      from opportunities o,
           lateral jsonb_array_elements_text(
             coalesce(o.facts -> 'must_have_skills', '[]'::jsonb) ||
             coalesce(o.facts -> 'nice_to_have_skills', '[]'::jsonb)
           ) as s(skill)
      where o.vectorize_model = any(${TRUSTED_MODELS})
      group by s.skill
    `)) as unknown as { skill: string; n: number }[];

    const byKey = new Map<string, { variant: string; n: number }[]>();
    for (const r of rows) {
      const key = canonSkillKey(r.skill);
      if (key.length < 2 || key.length > 40) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push({ variant: r.skill.trim(), n: r.n });
    }
    for (const [key, variants] of byKey) {
      const best = variants
        .filter((v) => looksIntentional(v.variant))
        .sort((a, b) => b.n - a.n)[0];
      if (best) map.set(key, best.variant);
    }
  } catch {
    // learned layer is an enhancement — a failed scan must never break the radar
  }
  cache = { map, at: Date.now() };
  return map;
}

/** Full resolution: explicit canon → learned casing → title-case fallback. */
export function displaySkillSmart(raw: string, learned: Map<string, string>): string {
  const key = canonSkillKey(raw);
  const explicit = displaySkill(key);
  // displaySkill returns the CANON form when it knows one; detect "it fell back
  // to title-case" by re-deriving the fallback and comparing
  const fellBack = explicit === titleFallbackOf(key);
  if (!fellBack) return explicit;
  return learned.get(key) ?? explicit;
}

// mirrors ./canon's unknown-skill path so we can tell canon hits from fallbacks
function titleFallbackOf(key: string): string {
  return key
    .split(" ")
    .map((w) => w.split("-").map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join("-"))
    .join(" ");
}
