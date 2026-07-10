/** Unit checks for the city canon map (pure, no DB). npx tsx tools/test-geo.ts */
import { cityMatch } from "../src/lib/geo/canon";

const cases: [string, string, boolean][] = [
  ["Bangalore, India", "Bengaluru", true],
  ["Bengaluru", "bangalore", true],
  ["New York City, NY", "NYC", true],
  ["San Francisco, CA | New York City, NY", "new york", true],
  ["Hybrid - San Francisco, Austin", "SF", true],
  ["Tokyo, Japan", "Tokyo", true],
  ["Warsaw", "San Francisco", false],
  ["Atlanta, GA", "LA", false], // token-only alias must not rewrite Atlanta
  ["Los Angeles, CA", "LA", true],
  ["Gurgaon, India", "Gurugram", true],
  ["London, UK", "United Kingdom", true],
  ["Remote, US", "Bengaluru", false],
];

let fail = 0;
for (const [loc, pref, want] of cases) {
  const got = cityMatch(loc, pref);
  if (got !== want) {
    fail++;
    console.log(`FAIL  ${loc}  ×  ${pref}  → ${got}, wanted ${want}`);
  } else console.log(` ok   ${loc}  ×  ${pref}  → ${got}`);
}
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
