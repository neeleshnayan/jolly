/**
 * POST /api/opportunities/signal — implicit-feedback log for the ranker.
 * Body: { kind: "impression"|"apply_click"|"applied"|"dismiss",
 *         opportunityId?  — single event
 *         opportunityIds? — batch (impressions: one POST per dashboard load) }
 * Dismiss acts immediately (the role leaves the user's ranking); everything
 * else is fuel for learned per-user weights later.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, rankingSignals } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

const KINDS = new Set(["impression", "apply_click", "applied", "dismiss", "up", "down"]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      u?: string;
      kind?: string;
      opportunityId?: string;
      opportunityIds?: string[];
    };
    const userId = await resolveUserId(body.u);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (!body.kind || !KINDS.has(body.kind)) return NextResponse.json({ error: "Bad kind" }, { status: 400 });
    const ids = [...new Set([...(body.opportunityIds ?? []), ...(body.opportunityId ? [body.opportunityId] : [])])]
      .filter((s) => typeof s === "string" && s.length > 10)
      .slice(0, 20);
    if (!ids.length) return NextResponse.json({ error: "No opportunity ids" }, { status: 400 });

    const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

    await db.insert(rankingSignals).values(ids.map((opportunityId) => ({ profileId: p.id, opportunityId, kind: body.kind! })));
    return NextResponse.json({ ok: true, logged: ids.length });
  } catch (err) {
    console.error("[/api/opportunities/signal]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
