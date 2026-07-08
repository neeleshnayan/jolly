/**
 * Board slugs are lowercase URL handles ("janestreet", "onemedical") — fine as
 * keys, embarrassing on a job card. Client-safe (plain data, no deps).
 */
const DISPLAY: Record<string, string> = {
  anthropic: "Anthropic",
  vercel: "Vercel",
  mistral: "Mistral AI",
  stripe: "Stripe",
  figma: "Figma",
  webflow: "Webflow",
  airtable: "Airtable",
  asana: "Asana",
  duolingo: "Duolingo",
  everlaw: "Everlaw",
  doximity: "Doximity",
  zocdoc: "Zocdoc",
  onemedical: "One Medical",
  point72: "Point72",
  janestreet: "Jane Street",
  sproutsocial: "Sprout Social",
  hootsuite: "Hootsuite",
  coursera: "Coursera",
  outschool: "Outschool",
  gitlab: "GitLab",
  remotecom: "Remote",
  phonepe: "PhonePe",
  groww: "Groww",
  postman: "Postman",
  meesho: "Meesho",
  sigmoid: "Sigmoid",
  monzo: "Monzo",
  gocardless: "GoCardless",
};

/** "janestreet" → "Jane Street"; unknown slugs get simple capitalization. */
export function displayCompany(slug: string | null | undefined): string {
  if (!slug) return "";
  if (DISPLAY[slug]) return DISPLAY[slug];
  // bookmarked rows may already carry a real name ("Acme Corp") — leave those
  if (/[A-Z ]/.test(slug)) return slug;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
