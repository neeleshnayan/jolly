/**
 * ONE canonical identity per city — the location twin of lib/skills/canon.
 * ATS boards write "Bangalore", "Bengaluru", "Bengaluru, India"; users type
 * "NYC" or "New York City"; both sides normalise here so preference filtering
 * and dream-city boosts match on MEANING, not spelling.
 *
 *   canonCity("NYC")                          → "new york"
 *   cityMatch("Bangalore, India", "Bengaluru") → true
 *
 * Alias policy: phrase aliases replace anywhere; SHORT tokens (sf, blr, nyc)
 * only replace as whole words so "la" can never rewrite "Atlanta".
 */

// applied longest-first so "new york city" wins over "new york"
const PHRASE_ALIAS: [RegExp, string][] = [
  [/\bnew york city\b/g, "new york"],
  [/\bnyc\b/g, "new york"],
  [/\bbangalore\b/g, "bengaluru"],
  [/\bblr\b/g, "bengaluru"],
  [/\bbombay\b/g, "mumbai"],
  [/\bnew delhi\b/g, "delhi"],
  [/\bgurgaon\b/g, "gurugram"],
  [/\bsan fran\b/g, "san francisco"],
  [/\bsf bay area\b/g, "san francisco"],
  [/\bsf\b/g, "san francisco"],
  [/\bsfo\b/g, "san francisco"],
  [/\bla\b(?=[ ,]|$)/g, "los angeles"], // token-only; never inside a word
  [/\bwashington,? d\.?c\.?\b/g, "washington dc"],
  [/\bsaint\b/g, "st"],
  [/\buk\b/g, "united kingdom"],
  [/\busa?\b/g, "united states"],
  [/\buae\b/g, "united arab emirates"],
];

/** Normalise free location text into canonical, alias-resolved form. */
export function canonLocationText(raw: string): string {
  let s = String(raw ?? "")
    .toLowerCase()
    .replace(/[()|;/·•]+/g, " ") // separators between multi-office listings
    .replace(/[^a-z0-9,\s.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, to] of PHRASE_ALIAS) s = s.replace(re, to);
  return s;
}

/** Canonical key for ONE city the user typed ("NYC " → "new york"). */
export function canonCity(raw: string): string {
  return canonLocationText(raw).replace(/,.*$/, "").trim();
}

/** Does a role's (messy, possibly multi-office) location mention this city? */
export function cityMatch(roleLocation: string | null | undefined, prefCity: string): boolean {
  if (!roleLocation) return false;
  const key = canonCity(prefCity);
  if (key.length < 3) return false; // too short to substring-match safely
  return canonLocationText(roleLocation).includes(key);
}

/** First matching city from a preference list, for "In {city}" copy. */
export function firstCityHit(roleLocation: string | null | undefined, cities: string[] | undefined): string | null {
  if (!cities?.length) return null;
  return cities.find((c) => cityMatch(roleLocation, c)) ?? null;
}
