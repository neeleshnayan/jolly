/**
 * POST /api/resume/suggest — the mentor→résumé feedback loop.
 * { userId, transcript } → { suggestions } where each bullet is resolved to a
 * concrete résumé entry (so the client can one-tap accept). Nothing is written
 * here; acceptance goes through /api/resume/suggest/apply.
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { profiles, sources } from "@/db/schema";
import { runAgent } from "@/agents/run";
import { resumeSuggester } from "@/agents/resume-suggester";
import { getFullProfile } from "@/lib/profile/read";
import { getMentorMap } from "@/lib/profile/map";
import { buildProfileText } from "@/lib/scoring/profileText";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 120;

function norm(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

// ---- hallucination gate ----------------------------------------------------
// The suggester must cite a verbatim quote of the candidate's own words. Local
// models routinely ignore "only what they said" instructions, so we verify here:
// a suggestion survives only if its evidence actually matches the candidate's
// lines ("You: …") in the transcript. Verbatim quotes drift a little through
// generation, so accept either a normalized substring hit or a strong word-overlap.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function candidateText(transcript: string): string {
  const userLines = transcript
    .split("\n")
    .filter((l) => /^\s*you\s*:/i.test(l))
    .join(" ");
  // transcripts from other formats may not prefix lines — fall back to everything
  return squash(userLines || transcript);
}

function evidenceChecksOut(evidence: string, saidText: string): boolean {
  const ev = squash(evidence);
  if (ev.length < 12) return false; // too short to prove anything
  if (saidText.includes(ev)) return true;
  const words = ev.split(" ").filter((w) => w.length > 3);
  if (words.length < 3) return false;
  const hits = words.filter((w) => saidText.includes(w)).length;
  return hits / words.length >= 0.75;
}

const hasPlaceholder = (s: string) => /\[[^\]]{1,30}\]/.test(s); // "[timeframe]", "[X%]"…

/**
 * GET /api/resume/suggest?u=<userId> — mentor tips ON DEMAND from the editor's
 * AI rail: re-reads the LATEST stored mentor-call transcript and suggests
 * résumé-worthy facts from it. Same engine as the post-call flow, no live call
 * needed. Returns { suggestions: [], noCall: true } if they've never talked.
 */
export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });
  const [call] = await db
    .select({ rawText: sources.rawText })
    .from(sources)
    .where(and(eq(sources.profileId, p.id), eq(sources.kind, "mentor_call")))
    .orderBy(desc(sources.createdAt))
    .limit(1);
  const transcript = call?.rawText ?? "";
  if (transcript.trim().length < 20) return NextResponse.json({ ok: true, suggestions: [], noCall: true });
  return suggestFrom(userId, transcript);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    if (transcript.trim().length < 20) return NextResponse.json({ ok: true, suggestions: [] });
    return suggestFrom(userId, transcript);
  } catch (err) {
    console.error("[/api/resume/suggest]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

async function suggestFrom(userId: string, transcript: string) {
  try {

    const [full, map] = await Promise.all([getFullProfile(userId), getMentorMap(userId)]);
    if (!full) return NextResponse.json({ error: "No profile" }, { status: 404 });

    const resumeText = buildProfileText(full, map.insights);
    const { output } = await runAgent(resumeSuggester, { transcript, resumeText }, { userId });

    // the gate: keep only suggestions the candidate verifiably said on the call
    const said = candidateText(transcript);
    const verified = output.suggestions.filter(
      (s) => evidenceChecksOut(s.evidence, said) && !hasPlaceholder(s.text),
    );
    if (verified.length < output.suggestions.length) {
      console.warn(
        `[resume/suggest] dropped ${output.suggestions.length - verified.length}/${output.suggestions.length} suggestion(s) with unverifiable evidence`,
      );
    }

    // resolve each bullet's targetRole to a concrete experience/project entry
    const targets = [
      ...full.experiences.map((e) => ({
        entryKind: "experience" as const,
        id: e.id,
        label: `${e.title ?? ""}${e.org ? ` @ ${e.org}` : ""}`.trim() || "Experience",
        hay: `${norm(e.org)} ${norm(e.title)}`,
      })),
      ...full.projects.map((p) => ({
        entryKind: "project" as const,
        id: p.id,
        label: p.name ?? "Project",
        hay: norm(p.name),
      })),
    ];

    const suggestions = verified.map((s) => {
      if (s.kind === "skill") return { ...s, entryKind: null, entryId: null, entryLabel: null };
      const t = norm(s.targetRole);
      const match =
        targets.find((x) => t && (x.hay.includes(t) || t.includes(x.hay.trim()))) ??
        targets.find((x) => t && x.hay.split(" ").some((w) => w && t.includes(w)));
      return {
        ...s,
        entryKind: match?.entryKind ?? null,
        entryId: match?.id ?? null,
        entryLabel: match?.label ?? null,
      };
    });

    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    console.error("[/api/resume/suggest]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
