/**
 * Currency-aware comp display. The vectorizer stores comp_min/max as raw
 * numbers in the JD's own currency — the number alone can't tell ₹35,00,000
 * from $350,000, so blindly prefixing ₹ made San Francisco roles read as
 * "₹3L–4L". Until extraction captures an explicit currency, infer it from the
 * job's location string; if we can't, show plain numbers with no symbol —
 * an honest "300k–400k" beats a confidently wrong rupee sign.
 */

import { normCurrency, fmtMoney } from "./currency";

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
  [/\bjapan\b|tokyo|osaka|kyoto/i, "Japan"],
  [/south korea|\bkorea\b|seoul/i, "South Korea"],
  [/australia|sydney|melbourne|brisbane|perth/i, "Australia"],
  [/new zealand|auckland|wellington/i, "New Zealand"],
  [/\buae\b|dubai|abu dhabi/i, "United Arab Emirates"],
  [/israel|tel aviv|\bhaifa\b/i, "Israel"],
  [/morocco|casablanca|rabat/i, "Morocco"],
  [/\bbrazil\b|são paulo|sao paulo|rio de janeiro/i, "Brazil"],
  [/\bmexico\b|mexico city|guadalajara/i, "Mexico"],
  [/romania|bucharest|cluj/i, "Romania"],
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

/** "₹35L–45L", "$300k–$400k", "S$180k–S$240k", or currency-less "300k–400k".
 *  Any ISO code the extraction emits renders via the currency table; the
 *  location inference only backstops rows that predate comp_currency. */
export function formatComp(min: number | null, max: number | null, location?: string | null, currency?: string | null): string | null {
  if (!min && !max) return null;
  const lo = min ?? max!;
  const hi = max ?? min!;
  const cur = normCurrency(currency) ?? inferCurrency(location);
  if (lo === hi) return fmtMoney(lo, cur);
  const a = fmtMoney(lo, cur);
  const b = fmtMoney(hi, cur);
  // "₹35L–45L" reads better than "₹35L–₹45L" — keep the ₹ once
  return a.startsWith("₹") && b.startsWith("₹") ? `${a}–${b.slice(1)}` : `${a}–${b}`;
}
