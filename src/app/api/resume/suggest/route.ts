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
import { getSessionUserId } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 120;

function norm(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

/**
 * GET /api/resume/suggest?u=<userId> — mentor tips ON DEMAND from the editor's
 * AI rail: re-reads the LATEST stored mentor-call transcript and suggests
 * résumé-worthy facts from it. Same engine as the post-call flow, no live call
 * needed. Returns { suggestions: [], noCall: true } if they've never talked.
 */
export async function GET(req: NextRequest) {
  const userId = (await getSessionUserId()) ?? req.nextUrl.searchParams.get("u");
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
    const userId = (await getSessionUserId()) ?? body.userId;
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

    const suggestions = output.suggestions.map((s) => {
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
