/**
 * POST /api/resume/suggest — the mentor→résumé feedback loop.
 * { userId, transcript } → { suggestions } where each bullet is resolved to a
 * concrete résumé entry (so the client can one-tap accept). Nothing is written
 * here; acceptance goes through /api/resume/suggest/apply.
 */
import { NextResponse } from "next/server";
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = (await getSessionUserId()) ?? body.userId;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    if (transcript.trim().length < 20) return NextResponse.json({ ok: true, suggestions: [] });

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
