/**
 * POST /api/resume/redesign — the whole-sheet AI overhaul.
 * { userId } → { styleConfig, rationale, content, condensed }. Produces new
 * CONTENT first (sharpened bullets — with licence to merge/cut toward one page
 * when the sheet overflows), THEN a new LOOK sized to the condensed content.
 * Nothing is written here — the user accepts from the side-by-side diff.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { resumeRedesigner } from "@/agents/resume-redesigner";
import { bulletRefiner } from "@/agents/bullet-refiner";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { toStyleConfig } from "@/lib/redesign/schema";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 300;

const OVERHAUL_BASE =
  "Rewrite these résumé bullets to be sharper and more impactful: strong past-tense action verbs, concrete and concise, quantify only what's already stated. NEVER invent metrics, tools, scope, or achievements that aren't in the originals.";

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Rough A4 model for BUDGETS only (never truth): bullet chars per rendered
// page after headers, education and skills take their share.
const PAGE_CHARS = 2400;
const ENTRY_OVERHEAD = 90; // title/org/dates lines + spacing
const BASE_OVERHEAD = 420; // name header + education + skills row

type Entry = { kind: "experience" | "project"; id: string; role: string; bullets: string[] };
const charsOf = (entries: Entry[]) =>
  BASE_OVERHEAD + entries.reduce((a, e) => a + ENTRY_OVERHEAD + e.bullets.reduce((x, b) => x + b.length + 30, 0), 0);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveUserId(body.userId);
    if (!resolved) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const userId: string = resolved;

    const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
    if (!full) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const profileText = buildProfileText(full, map.insights);

    // measure what the SHEET actually renders (profileText carries mentor
    // insights and would overestimate the page count)
    const entries: Entry[] = [
      ...full.experiences.map((e) => ({
        kind: "experience" as const,
        id: e.id,
        role: `${e.title ?? ""}${e.org ? ` at ${e.org}` : ""}`,
        bullets: (e.bullets ?? []).map((b) => strip(b.text)).filter(Boolean),
      })),
      ...full.projects.map((p) => ({
        kind: "project" as const,
        id: p.id,
        role: p.name ?? "project",
        bullets: (p.bullets ?? []).map((b) => strip(b.text)).filter(Boolean),
      })),
    ];
    const pagesBefore = charsOf(entries) / PAGE_CHARS;

    // one-page budgets: when the sheet overflows, each entry gets a bullet
    // budget — recent entries keep more of their story, older ones concede
    // first (entries arrive newest-first; projects trail experiences)
    // aim slightly OVER one page of content — the style tokens (bodyScale,
    // density, bulletGap) absorb the last ~15%, so budgets can cut less deep
    const squeeze = pagesBefore > 1.08;
    const keepRatio = Math.min(1, Math.max(0.4, 1.18 / pagesBefore));
    const budgetFor = (n: number, idx: number) => {
      if (!squeeze || n <= 2) return n;
      const recency = Math.max(0.75, 1.15 - 0.15 * idx);
      return Math.max(2, Math.min(n, Math.round(n * keepRatio * recency)));
    };

    // the mentor's read on this person steers the rewrite toward what matters
    const insightNote = map.insights.length
      ? ` The user's mentor learned these things about them: ${map.insights.map((i) => i.content).join("; ")}. Where it's truthful and supported by the bullet, let the rewrite reflect these strengths and priorities — but never invent.`
      : "";
    // optional target JD: reframe emphasis toward what the role actually asks
    // for (vocabulary, ordering, which achievements lead) — content stays true
    const jd = typeof body.jd === "string" && body.jd.trim() ? body.jd.trim().slice(0, 12000) : null;
    const jdNote = jd
      ? ` The user is targeting this specific job — emphasize the experience most relevant to it and, where truthful, use its vocabulary: """${jd}"""`
      : "";
    // the ATS check's missing keywords close the loop: translate what's already
    // true into screen-legible vocabulary — never manufacture what isn't there
    const missing = Array.isArray(body.missingKeywords)
      ? (body.missingKeywords as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 20)
      : [];
    const atsNote = missing.length
      ? ` An ATS keyword check found these JD terms MISSING from the résumé: ${missing.join(", ")}. Where a bullet ALREADY truthfully demonstrates one of these, rephrase it to use that exact term (e.g. work that plainly used Python should say "Python"). If nothing on the résumé genuinely supports a term, LEAVE IT OUT — never fabricate experience to satisfy a keyword.`
      : "";
    // mentor tips the user TICKED in the wizard — explicit, user-approved guidance
    const guidance = Array.isArray(body.guidance)
      ? (body.guidance as unknown[]).filter((g): g is string => typeof g === "string").slice(0, 10)
      : [];
    const guidanceNote = guidance.length
      ? ` The user selected these mentor tips as guidance for the rewrite (they approved each one — weave them in where the underlying bullet supports it): ${guidance.map((g) => `"${g}"`).join("; ")}.`
      : "";
    // content authority, unlocked ONLY when the sheet overflows: styling alone
    // cannot make a dense two-pager fit, so the rewrite may merge and cut —
    // but inventing is never on the table
    const condenseNote = squeeze
      ? " THIS RÉSUMÉ OVERFLOWS ONE PAGE, and one tight page beats two loose ones — so you also have licence to condense: MERGE bullets telling the same story into one stronger line, and CUT lines that add little for the direction this candidate is heading. Keep what differentiates them; the survivors must read as a coherent story with no references to removed lines."
      : "";
    const OVERHAUL = OVERHAUL_BASE + condenseNote + insightNote + jdNote + atsNote + guidanceNote;

    // 1) the new content — sharpen (and, under squeeze, condense) each entry's
    //    bullets (sequential; the local model is one GPU). Falls back to the
    //    originals if a rewrite fails.
    async function rewrite(role: string, plain: string[], budget: number): Promise<string[]> {
      const cap =
        budget < plain.length
          ? ` Return at MOST ${budget} of these ${plain.length} bullets (fewer is fine). PREFER MERGING over cutting so strong achievements survive: a merged line may carry two related wins. Quantified results, awards, and named outcomes (savings, revenue, rankings) are the LAST things to cut — drop vague process lines first. Order by impact.`
          : "";
      try {
        const { output } = await runAgent(bulletRefiner, { instruction: OVERHAUL + cap, bullets: plain, role }, { userId });
        const out = (output.bullets ?? []).map((b) => b.trim()).filter(Boolean);
        // authority has limits: never empty, never longer than the original set
        return out.length ? out.slice(0, Math.max(budget, 1)) : plain;
      } catch {
        return plain;
      }
    }

    const experiences: { id: string; bullets: string[] }[] = [];
    const projects: { id: string; bullets: string[] }[] = [];
    const proposed: Entry[] = [];
    let bulletsBefore = 0;
    let bulletsAfter = 0;
    for (const [idx, e] of entries.entries()) {
      if (!e.bullets.length) continue;
      const b = await rewrite(e.role, e.bullets, budgetFor(e.bullets.length, idx));
      bulletsBefore += e.bullets.length;
      bulletsAfter += b.length;
      (e.kind === "experience" ? experiences : projects).push({ id: e.id, bullets: b });
      proposed.push({ ...e, bullets: b });
    }

    // 2) the new look — sized to the CONDENSED content, not the old sheet
    const pagesAfter = charsOf(proposed) / PAGE_CHARS;
    const { output: design } = await runAgent(
      resumeRedesigner,
      { profileText, pages: Math.round(pagesAfter * 10) / 10 },
      { userId },
    );

    const r1 = (n: number) => Math.round(n * 10) / 10;
    return NextResponse.json({
      ok: true,
      styleConfig: toStyleConfig(design),
      rationale: design.rationale,
      content: { experiences, projects },
      condensed:
        squeeze && bulletsAfter < bulletsBefore
          ? { before: bulletsBefore, after: bulletsAfter, pagesBefore: r1(pagesBefore), pagesAfter: r1(pagesAfter) }
          : null,
    });
  } catch (err) {
    console.error("[/api/resume/redesign]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
