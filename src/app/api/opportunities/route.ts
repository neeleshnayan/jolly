/**
 * POST /api/opportunities  { jd, url?, source? } — ingest a role.
 * Vectorizes the JD and stores it. This is the "paste a job description" path;
 * ATS feeds will call the same vectorize+persist underneath.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { opportunityVectorizer } from "@/agents/opportunity-vectorizer";
import { persistOpportunity } from "@/lib/opportunities/persist";
import { ensureProfile } from "@/lib/profile/ensure";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const { jd, url, source, userId: suppliedUserId } = await req.json().catch(() => ({}));
    // writes a role + burns GPU — signed-in users only
    const userId = await resolveUserId(typeof suppliedUserId === "string" ? suppliedUserId : null);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof jd !== "string" || jd.trim().length < 40) {
      return NextResponse.json({ error: "Paste a fuller job description (jd)" }, { status: 400 });
    }
    const addedByProfileId = await ensureProfile(userId);

    const { output } = await runAgent(opportunityVectorizer, { jd }, { userId });
    const { id } = await persistOpportunity({
      extraction: output,
      jd,
      url: typeof url === "string" ? url : null,
      source: source ?? "pasted",
      addedByProfileId,
    });

    return NextResponse.json({ ok: true, id, facts: output.facts });
  } catch (err) {
    console.error("[/api/opportunities]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
