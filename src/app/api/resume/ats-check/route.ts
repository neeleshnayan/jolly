/**
 * POST /api/resume/ats-check — { jd?, opportunityId? } → { score, required, preferred }.
 * The Teal-style "does my résumé pass the keyword screen" check:
 *   1. keywords come from the job's ONE-TIME vectorisation (facts.must_have /
 *      nice_to_have) when we have an opportunityId — zero LLM, understand-once.
 *      Only a pasted JD (no vectorised opportunity) runs the on-demand extractor.
 *   2. DETERMINISTIC matching against the résumé text — no model opinion on
 *      whether something matches, so no hallucinated passes
 * Score = required coverage (80%) + preferred coverage (20%).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { runAgent } from "@/agents/run";
import { jdKeywordExtractor, sanitize } from "@/agents/jd-keywords";
import { getFullProfile } from "@/lib/profile/read";
import { buildProfileText } from "@/lib/scoring/profileText";
import { resolveUserId } from "@/lib/auth/user";
import { cleanJd } from "@/lib/jobs/jd";

export const runtime = "nodejs";
export const maxDuration = 60;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ").replace(/\s+/g, " ").trim();

/** keyword present in the résumé? exact normalized substring, or (for
 *  multi-word keywords) most of its meaningful words present individually */
function hits(keyword: string, resume: string): boolean {
  const k = squash(keyword);
  if (!k) return false;
  if (resume.includes(k)) return true;
  const words = k.split(" ").filter((w) => w.length > 2);
  if (words.length < 2) return false;
  return words.filter((w) => resume.includes(w)).length / words.length >= 0.7;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { userId?: string; jd?: string; opportunityId?: string };
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const full = await getFullProfile(userId);
    if (!full) return NextResponse.json({ error: "No résumé on file" }, { status: 404 });
    const resume = squash(buildProfileText(full, []));

    // 1) reuse the job's one-time vectorisation when we have it — no LLM. The
    //    role's skills were already extracted (must_have/nice_to_have); the ATS
    //    check is just deterministic matching, so re-running a model per open is
    //    pure waste. Sanitize for parity with the on-demand extractor's output.
    let reqTerms: string[] | null = null;
    let niceTerms: string[] = [];
    if (typeof body.opportunityId === "string") {
      const [opp] = await db
        .select({ facts: opportunities.facts })
        .from(opportunities)
        .where(eq(opportunities.id, body.opportunityId))
        .limit(1);
      const f = (opp?.facts ?? {}) as { must_have_skills?: string[]; nice_to_have_skills?: string[] };
      const must = sanitize(f.must_have_skills ?? []);
      const nice = sanitize(f.nice_to_have_skills ?? []);
      if (must.length || nice.length) {
        reqTerms = must;
        niceTerms = nice;
      }
    }

    // 2) fall back to the on-demand extractor for a pasted JD / un-vectorised role
    if (reqTerms === null) {
      // decode/strip any HTML the JD arrived with — a pasted JD full of
      // &quot;/<div> noise otherwise poisons keyword extraction
      const jd = typeof body.jd === "string" ? cleanJd(body.jd).slice(0, 12000) : "";
      if (jd.length < 80) return NextResponse.json({ error: "Paste the full job description first" }, { status: 400 });
      const { output } = await runAgent(jdKeywordExtractor, { jd }, { userId });
      reqTerms = output.required;
      niceTerms = output.preferred;
    }

    const required = reqTerms.map((term) => ({ term, hit: hits(term, resume) }));
    const preferred = niceTerms.map((term) => ({ term, hit: hits(term, resume) }));
    const rScore = required.length ? required.filter((x) => x.hit).length / required.length : 1;
    const pScore = preferred.length ? preferred.filter((x) => x.hit).length / preferred.length : 1;
    const score = Math.round(100 * (0.8 * rScore + 0.2 * pScore));

    return NextResponse.json({ ok: true, score, required, preferred });
  } catch (err) {
    console.error("[/api/resume/ats-check]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
