/**
 * POST /api/resume/ats-check — { jd } → { score, required, preferred }.
 * The Teal-style "does my résumé pass the keyword screen" check:
 *   1. small local model extracts the JD's checkable keywords (fast, think:false)
 *   2. DETERMINISTIC matching against the résumé text — no model opinion on
 *      whether something matches, so no hallucinated passes
 * Score = required coverage (80%) + preferred coverage (20%).
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { jdKeywordExtractor } from "@/agents/jd-keywords";
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
    const body = (await req.json().catch(() => ({}))) as { userId?: string; jd?: string };
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    // decode/strip any HTML the JD arrived with — a pasted or stored JD full of
    // &quot;/<div> noise otherwise poisons keyword extraction
    const jd = typeof body.jd === "string" ? cleanJd(body.jd).slice(0, 12000) : "";
    if (jd.length < 80) return NextResponse.json({ error: "Paste the full job description first" }, { status: 400 });

    const full = await getFullProfile(userId);
    if (!full) return NextResponse.json({ error: "No résumé on file" }, { status: 404 });
    const resume = squash(buildProfileText(full, []));

    const { output } = await runAgent(jdKeywordExtractor, { jd }, { userId });

    const required = output.required.map((term) => ({ term, hit: hits(term, resume) }));
    const preferred = output.preferred.map((term) => ({ term, hit: hits(term, resume) }));
    const rScore = required.length ? required.filter((x) => x.hit).length / required.length : 1;
    const pScore = preferred.length ? preferred.filter((x) => x.hit).length / preferred.length : 1;
    const score = Math.round(100 * (0.8 * rScore + 0.2 * pScore));

    return NextResponse.json({ ok: true, score, required, preferred });
  } catch (err) {
    console.error("[/api/resume/ats-check]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
