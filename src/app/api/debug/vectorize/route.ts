/**
 * POST /api/debug/vectorize  { jd } — run the opportunity vectorizer on a pasted
 * JD and return facts + vector, without persisting. Test surface for tuning the
 * agent before the ingestion pipeline is wired.
 */
import { NextResponse } from "next/server";
import { runAgent } from "@/agents/run";
import { opportunityVectorizer } from "@/agents/opportunity-vectorizer";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  // debug surface: invisible in production except to the admin
  if (process.env.NODE_ENV === "production" && !(await requireAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const { jd } = await req.json().catch(() => ({}));
    if (typeof jd !== "string" || jd.trim().length < 40) {
      return NextResponse.json({ error: "Paste a fuller job description (jd)" }, { status: 400 });
    }
    const { output } = await runAgent(opportunityVectorizer, { jd }, { userId: "debug" });
    return NextResponse.json({ ok: true, ...output });
  } catch (err) {
    console.error("[/api/debug/vectorize]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
