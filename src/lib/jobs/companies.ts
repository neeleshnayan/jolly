import type { Source } from "./ats";

/**
 * The boards to pull from. `slug` is the company handle in the board URL:
 *   greenhouse → boards.greenhouse.io/<slug>
 *   lever      → jobs.lever.co/<slug>
 * Deliberately a VERTICAL MIX — early users are diverse (lawyers, designers,
 * doctors, engineers, PMs, remote side-hustlers), so the pool must be too.
 * All slugs live-probed 2026-07-07.
 */
export const COMPANIES: { source: Source; slug: string }[] = [
  // tech / AI
  { source: "greenhouse", slug: "anthropic" },
  { source: "greenhouse", slug: "vercel" },
  { source: "lever", slug: "mistral" },
  { source: "greenhouse", slug: "stripe" },
  // design & product
  { source: "greenhouse", slug: "figma" },
  { source: "greenhouse", slug: "webflow" },
  { source: "greenhouse", slug: "airtable" },
  { source: "greenhouse", slug: "asana" },
  { source: "greenhouse", slug: "duolingo" },
  // legal (legal-tech hires counsel, legal ops, paralegals — not just devs)
  { source: "greenhouse", slug: "everlaw" },
  // health (clinical + ops + tech)
  { source: "greenhouse", slug: "doximity" },
  { source: "greenhouse", slug: "zocdoc" },
  // remote-first (the side-hustle / work-from-anywhere pool)
  { source: "greenhouse", slug: "gitlab" },
  { source: "greenhouse", slug: "remotecom" },
  // india
  { source: "greenhouse", slug: "phonepe" },
  { source: "greenhouse", slug: "groww" },
  { source: "greenhouse", slug: "postman" },
];
