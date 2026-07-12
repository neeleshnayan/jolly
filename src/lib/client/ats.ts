/**
 * Live, client-side ATS re-scoring — BYTE-IDENTICAL to the server
 * (src/app/api/resume/ats-check). The server does the smart part once: an LLM
 * extracts the JD's required/preferred keywords. The hit-test — does the résumé
 * contain each term — is deterministic string work, so we run it in the browser
 * against the LIVE résumé on every keystroke: same buildProfileText, same
 * squash, same hits(), same 80/20 weighting → the ✓/✗ chips and the score
 * update instantly, no re-check round-trip, zero quality change.
 */
import { buildProfileText } from "@/lib/scoring/profileText";

type ProfileArg = Parameters<typeof buildProfileText>[0];
export type AtsResult = { score: number; required: { term: string; hit: boolean }[]; preferred: { term: string; hit: boolean }[] };

// mirror of the server's squash + hits (keep in lockstep with ats-check/route.ts)
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ").replace(/\s+/g, " ").trim();
function hits(keyword: string, resume: string): boolean {
  const k = squash(keyword);
  if (!k) return false;
  if (resume.includes(k)) return true;
  const words = k.split(" ").filter((w) => w.length > 2);
  if (words.length < 2) return false;
  return words.filter((w) => resume.includes(w)).length / words.length >= 0.7;
}

/** Re-run the ATS hit-test + score against the current résumé state. */
export function liveAts(ats: AtsResult, profile: ProfileArg): AtsResult {
  const resume = squash(buildProfileText(profile, []));
  const required = ats.required.map((x) => ({ term: x.term, hit: hits(x.term, resume) }));
  const preferred = ats.preferred.map((x) => ({ term: x.term, hit: hits(x.term, resume) }));
  const rScore = required.length ? required.filter((x) => x.hit).length / required.length : 1;
  const pScore = preferred.length ? preferred.filter((x) => x.hit).length / preferred.length : 1;
  return { score: Math.round(100 * (0.8 * rScore + 0.2 * pScore)), required, preferred };
}
