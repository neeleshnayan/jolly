/**
 * POST /api/voice/queue — the call lane. { action: "join" | "beat" | "leave" }
 * join/beat are the same operation (idempotent + heartbeat); the client polls
 * it while waiting and beats during the call. leave releases immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { callBookings, profiles } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";
import { joinOrBeat, leave } from "@/lib/voice/queue";

export const runtime = "nodejs";

/** A booked slot happening NOW (−10min…+30min) = front-of-line priority. */
async function hasActiveBooking(userId: string): Promise<boolean> {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return false;
  const now = Date.now();
  const rows = await db
    .select({ id: callBookings.id })
    .from(callBookings)
    .where(
      and(
        eq(callBookings.profileId, p.id),
        eq(callBookings.status, "booked"),
        gte(callBookings.slotAt, new Date(now - 30 * 60000)),
        lte(callBookings.slotAt, new Date(now + 10 * 60000)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; action?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (body.action === "leave") {
    leave(userId);
    return NextResponse.json({ ok: true, state: "left" });
  }
  const priority = await hasActiveBooking(userId).catch(() => false);
  return NextResponse.json({ ok: true, ...joinOrBeat(userId, priority) });
}
