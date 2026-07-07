import type { Source } from "./ats";

/**
 * The boards to pull from. `slug` is the company handle in the board URL:
 *   greenhouse → boards.greenhouse.io/<slug>
 *   lever      → jobs.lever.co/<slug>
 * Curate this to the companies you actually want to surface roles from.
 * All of these were probed live on 2026-07-06 and respond with public JSON.
 */
export const COMPANIES: { source: Source; slug: string }[] = [
  { source: "greenhouse", slug: "anthropic" },
  { source: "greenhouse", slug: "vercel" },
  { source: "lever", slug: "mistral" },
  { source: "greenhouse", slug: "figma" },
  { source: "greenhouse", slug: "stripe" },
  // { source: "greenhouse", slug: "databricks" },  // huge board — enable when cap is higher
];
