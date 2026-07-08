/**
 * POST /api/resume/redesign — the whole-sheet AI overhaul.
 * { userId } → { styleConfig, rationale, content }. Produces a new LOOK (style
 * tokens) AND new CONTENT (sharpened bullets per role/project) so the client can
 * show a side-by-side diff. Nothing is written here — the user accepts.
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
  "Rewrite these résumé bullets to be sharper and more impactful: strong past-tense action verbs, concrete and concise, quantify only what's already stated. Keep every achievement — never drop, merge, or invent.";

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveUserId(body.userId);
    if (!resolved) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const userId: string = resolved;

    const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
    if (!full) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const profileText = buildProfileText(full, map.insights);
    const pages = Math.max(1, Math.round(profileText.length / 2600));

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
    const OVERHAUL = OVERHAUL_BASE + insightNote + jdNote + atsNote + guidanceNote;

    // 1) the new look
    const { output: design } = await runAgent(resumeRedesigner, { profileText, pages }, { userId });

    // 2) the new content — sharpen each role/project's bullets (sequential; the
    //    local model is one GPU). Falls back to the originals if a rewrite fails.
    async function rewrite(role: string, bullets: { text: string }[] | null): Promise<string[] | null> {
      const plain = (bullets ?? []).map((b) => strip(b.text)).filter(Boolean);
      if (!plain.length) return null;
      try {
        const { output } = await runAgent(bulletRefiner, { instruction: OVERHAUL, bullets: plain, role }, { userId });
        return output.bullets?.length ? output.bullets : plain;
      } catch {
        return plain;
      }
    }

    const experiences = [];
    for (const e of full.experiences) {
      const b = await rewrite(`${e.title ?? ""}${e.org ? ` at ${e.org}` : ""}`, e.bullets);
      if (b) experiences.push({ id: e.id, bullets: b });
    }
    const projects = [];
    for (const p of full.projects) {
      const b = await rewrite(p.name ?? "project", p.bullets);
      if (b) projects.push({ id: p.id, bullets: b });
    }

    return NextResponse.json({
      ok: true,
      styleConfig: toStyleConfig(design),
      rationale: design.rationale,
      content: { experiences, projects },
    });
  } catch (err) {
    console.error("[/api/resume/redesign]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
