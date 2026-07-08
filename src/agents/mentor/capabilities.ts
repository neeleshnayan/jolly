/**
 * Mentor capabilities — the sub-agent seam. Each capability watches the
 * conversation (deterministically — no LLM in the hot path; a voice turn has a
 * ~1s budget) and, when its moment comes, injects a focused BRIEF into the
 * system prompt for that turn. The live model stays one small fast brain; the
 * "sub-agents" are context assemblers that make it feel like it went away and
 * did homework.
 *
 * v1 capability: ROLE DOSSIER — the user names a role/company from their
 * world (their matches or applications) → the mentor gets the JD's facts,
 * where they stand against it, and how to prep. More capabilities register
 * the same way: detect(text) → brief().
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { rankMatches, type RankedJob } from "@/lib/opportunities/recommend";
import type { OpportunityFacts } from "@/lib/opportunities/schema";
import { formatComp } from "@/lib/format/comp";

const RANKED_TTL_MS = 3 * 60 * 1000;
const rankedCache = new Map<string, { at: number; ranked: RankedJob[] }>();

async function rankedFor(userId: string): Promise<RankedJob[]> {
  const hit = rankedCache.get(userId);
  if (hit && Date.now() - hit.at < RANKED_TTL_MS) return hit.ranked;
  const ranked = await rankMatches(userId).catch(() => []);
  rankedCache.set(userId, { at: Date.now(), ranked });
  if (rankedCache.size > 200) rankedCache.delete(rankedCache.keys().next().value!);
  return ranked;
}

const words = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3);

/** Which of THEIR roles is the user talking about right now? Word overlap on
 *  company name or most of a title — deterministic and cheap. */
function detectRole(lastUserText: string, ranked: RankedJob[]): RankedJob | null {
  const t = ` ${lastUserText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  let best: { job: RankedJob; score: number } | null = null;
  for (const job of ranked.slice(0, 30)) {
    let score = 0;
    const co = (job.company ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
    if (co.length >= 4 && t.includes(` ${co} `)) score += 2;
    const tw = words(job.title);
    if (tw.length) {
      const hitRatio = tw.filter((w) => t.includes(` ${w} `)).length / tw.length;
      if (hitRatio >= 0.5) score += hitRatio;
    }
    if (score >= 2 && (!best || score > best.score)) best = { job, score };
  }
  return best?.job ?? null;
}

/** The dossier block: what the role asks, where they stand, how to prep. */
async function roleDossier(job: RankedJob): Promise<string> {
  // facts (min years, credentials) live in the row's jsonb, not on RankedJob
  const [row] = await db.select({ facts: opportunities.facts }).from(opportunities).where(eq(opportunities.id, job.id)).limit(1);
  const f = (row?.facts ?? {}) as Partial<OpportunityFacts>;
  const comp = formatComp(job.compMin, job.compMax, job.location, job.compCurrency);
  const bars = [
    f.min_years_experience ? `${f.min_years_experience}+ years` : null,
    ...(f.required_credentials ?? []),
  ].filter(Boolean);

  return `\n\nLIVE BRIEF — they are talking about a role you know well. Use this to be CONCRETE (weave it in naturally as their mentor — never read it out like a list):
ROLE: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}${comp ? ` — comp ${comp}` : ""}
WHAT IT ACTUALLY IS: ${job.summary}
WHAT THE SCREEN ASKS FOR:${bars.length ? ` [hard bars: ${bars.join(", ")}]` : ""}
${(job.coreRequirements ?? []).slice(0, 5).map((r) => `- ${r}`).join("\n")}
WHERE THEY STAND (from your matching): ${job.reasons.slice(0, 2).join("; ") || "solid overall fit"}${job.gaps.length ? ` — watch: ${job.gaps.slice(0, 2).join("; ")}` : ""}
HOW TO PREP (coach with this): for each requirement above, help them pick ONE specific story from their own history that proves it — the strongest prep is their own evidence, rehearsed out loud. If a hard bar is a real miss, say so honestly and discuss whether to spend the credit anyway.`;
}

/** The registry. Runs on the LAST user message only; first hit wins; "" = no
 *  capability fired this turn. New capabilities: add a {detect, brief} pair. */
export async function capabilityBrief(userId: string, messages: { role: string; content: string }[]): Promise<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (lastUser.trim().length < 8) return "";
  try {
    const ranked = await rankedFor(userId);
    const job = detectRole(lastUser, ranked);
    if (job) return await roleDossier(job);
  } catch {
    /* capability failure must never break the live turn */
  }
  return "";
}
