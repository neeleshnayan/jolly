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
