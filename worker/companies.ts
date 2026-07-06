import type { Source } from "./ats";

/**
 * The boards to pull from. `slug` is the company handle in the board URL:
 *   greenhouse → boards.greenhouse.io/<slug>
 *   lever      → jobs.lever.co/<slug>
 * Curate this to the companies you actually want to surface roles from.
 * (leverdemo is Lever's public sample board — handy for a first test run.)
 */
export const COMPANIES: { source: Source; slug: string }[] = [
  { source: "lever", slug: "leverdemo" },
  // { source: "greenhouse", slug: "yourcompany" },
  // { source: "lever", slug: "yourcompany" },
];
