/**
 * Currency-aware comp display. The vectorizer stores comp_min/max as raw
 * numbers in the JD's own currency — the number alone can't tell ₹35,00,000
 * from $350,000, so blindly prefixing ₹ made San Francisco roles read as
 * "₹3L–4L". Until extraction captures an explicit currency, infer it from the
 * job's location string; if we can't, show plain numbers with no symbol —
 * an honest "300k–400k" beats a confidently wrong rupee sign.
 */

type Currency = "INR" | "USD" | "GBP" | "EUR" | null;

const INR_HINTS = /india|bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi/i;
const GBP_HINTS = /\buk\b|united kingdom|london|manchester|edinburgh|dublin/i; // dublin≈EUR but close enough to flag non-US
const EUR_HINTS = /germany|berlin|munich|france|paris|amsterdam|netherlands|spain|madrid|barcelona|italy|milan|lisbon|portugal|brussels|belgium|zurich|switzerland|stockholm|sweden|copenhagen|denmark|helsinki|finland|oslo|norway|vienna|austria|warsaw|poland|prague|czech/i;
const USD_HINTS = /\busa?\b|united states|san francisco|new york|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|washington|portland|philadelphia|dallas|houston|phoenix|san diego|san jose|canada|toronto|vancouver/i;

export function inferCurrency(location: string | null | undefined): Currency {
  const loc = location ?? "";
  if (!loc) return null;
  if (INR_HINTS.test(loc)) return "INR";
  if (GBP_HINTS.test(loc)) return "GBP";
  if (EUR_HINTS.test(loc)) return "EUR";
  // US-style "City, ST" state codes or explicit US markers
  if (/,\s*[A-Z]{2}(\s*\||$)/.test(loc) || USD_HINTS.test(loc)) return "USD";
  return null;
}

/** Deterministic country from a free-text location. The bake-off showed BOTH
 *  gemma4 and gemma3:27b leave `facts.country` null even with an obvious location
 *  (country-from-location is a lookup, not reasoning) — so this is the reliable
 *  fallback: extraction's country wins when present, this fills the (many) gaps.
 *  Order matters: most specific / least ambiguous first. */
const COUNTRY_HINTS: [RegExp, string][] = [
  [/india|bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi/i, "India"],
  [/\bireland\b|dublin/i, "Ireland"],
  [/\buk\b|united kingdom|england|scotland|wales|london|manchester|edinburgh|birmingham|bristol|leeds|glasgow|cambridge|oxford/i, "United Kingdom"],
  [/germany|berlin|munich|münchen|hamburg|frankfurt|cologne/i, "Germany"],
  [/france|paris|lyon|toulouse/i, "France"],
  [/netherlands|amsterdam|rotterdam|utrecht|the hague/i, "Netherlands"],
  [/spain|madrid|barcelona|valencia/i, "Spain"],
  [/\bitaly\b|milan|rome|turin/i, "Italy"],
  [/portugal|lisbon|porto/i, "Portugal"],
  [/switzerland|zurich|zürich|geneva|lausanne/i, "Switzerland"],
  [/sweden|stockholm|gothenburg/i, "Sweden"],
  [/poland|warsaw|krakow|kraków|wroclaw/i, "Poland"],
  [/singapore/i, "Singapore"],
  [/australia|sydney|melbourne|brisbane|perth/i, "Australia"],
  [/\buae\b|dubai|abu dhabi/i, "United Arab Emirates"],
  [/morocco|casablanca|rabat/i, "Morocco"],
  [/canada|toronto|vancouver|montreal|montréal|ottawa|calgary|waterloo/i, "Canada"],
];

export function inferCountry(location: string | null | undefined): string | null {
  const loc = location ?? "";
  if (!loc) return null;
  for (const [re, country] of COUNTRY_HINTS) if (re.test(loc)) return country;
  // US-style "City, ST" state codes, or explicit US markers
  if (/,\s*[A-Z]{2}(\s|,|\||$)/.test(loc) || /\busa?\b|united states|san francisco|new york|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|washington|portland|philadelphia|dallas|houston|phoenix|san diego|san jose|remote - us/i.test(loc)) {
    return "United States";
  }
  return null;
}

/** "₹35L–45L", "$300k–$400k", "£90k–£110k", or currency-less "300k–400k". */
export function formatComp(min: number | null, max: number | null, location?: string | null, currency?: string | null): string | null {
  if (!min && !max) return null;
  const lo = min ?? max!;
  const hi = max ?? min!;
  const cur = (currency as Currency) ?? inferCurrency(location);

  if (cur === "INR") {
    const l = (n: number) => (n >= 100000 ? `${Math.round(n / 100000)}L` : `${Math.round(n / 1000)}k`);
    return lo === hi ? `₹${l(lo)}` : `₹${l(lo)}–${l(hi)}`;
  }
  const sym = cur === "USD" ? "$" : cur === "GBP" ? "£" : cur === "EUR" ? "€" : "";
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  return lo === hi ? `${sym}${k(lo)}` : `${sym}${k(lo)}–${sym}${k(hi)}`;
}
