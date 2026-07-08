/**
 * The AI mentor's diary — 30-minute slots, one person per slot.
 *   GET  — the next 3 days of slots (taken/free/yours) + your upcoming booking
 *   POST — { slotAt } books; { cancel: bookingId } frees
 * A booking shapes demand and sets expectation ("my mentor expects me at 7:30");
 * at slot time the holder gets priority in the live-call lane.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { callBookings, profiles } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";

const SLOT_MIN = 30;
const DAY_START_H = 7; // mentor's "office hours", local server time
const DAY_END_H = 23;
const DAYS_AHEAD = 3;

async function profileIdFor(userId: string) {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return p?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req.nextUrl.searchParams.get("u"));
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const pid = await profileIdFor(userId);
  if (!pid) return NextResponse.json({ error: "No profile" }, { status: 404 });

  const now = new Date();
  const horizon = new Date(now.getTime() + DAYS_AHEAD * 86400000);
  const booked = await db
    .select({ id: callBookings.id, slotAt: callBookings.slotAt, profileId: callBookings.profileId })
    .from(callBookings)
    .where(and(gte(callBookings.slotAt, now), eq(callBookings.status, "booked")));
  const byTime = new Map(booked.map((b) => [new Date(b.slotAt).getTime(), b]));

  const days: { date: string; slots: { at: string; state: "free" | "taken" | "yours" }[] }[] = [];
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    day.setHours(DAY_START_H, 0, 0, 0);
    const slots: { at: string; state: "free" | "taken" | "yours" }[] = [];
    for (let t = new Date(day); t.getHours() < DAY_END_H; t = new Date(t.getTime() + SLOT_MIN * 60000)) {
      if (t <= now || t > horizon) continue;
      const hit = byTime.get(t.getTime());
      slots.push({ at: t.toISOString(), state: hit ? (hit.profileId === pid ? "yours" : "taken") : "free" });
    }
    if (slots.length) days.push({ date: day.toDateString(), slots });
  }
  const mine = booked.find((b) => b.profileId === pid);
  return NextResponse.json({ ok: true, days, mine: mine ? { id: mine.id, slotAt: mine.slotAt } : null });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; slotAt?: string; cancel?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const pid = await profileIdFor(userId);
  if (!pid) return NextResponse.json({ error: "No profile" }, { status: 404 });

  if (body.cancel) {
    await db
      .update(callBookings)
      .set({ status: "cancelled" })
      .where(and(eq(callBookings.id, body.cancel), eq(callBookings.profileId, pid)));
    return NextResponse.json({ ok: true });
  }

  const slot = body.slotAt ? new Date(body.slotAt) : null;
  if (!slot || isNaN(slot.getTime()) || slot.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Pick a future slot" }, { status: 400 });
  }
  if (slot.getMinutes() % SLOT_MIN !== 0 || slot.getSeconds() !== 0) {
    return NextResponse.json({ error: "Slots start on the half hour" }, { status: 400 });
  }
  // one upcoming booking per person — cancel-then-rebook to move it
  const existing = await db
    .select({ id: callBookings.id })
    .from(callBookings)
    .where(and(eq(callBookings.profileId, pid), eq(callBookings.status, "booked"), gte(callBookings.slotAt, new Date())));
  if (existing.length) return NextResponse.json({ error: "You already have a slot booked — cancel it first to move it" }, { status: 409 });

  try {
    const [row] = await db.insert(callBookings).values({ profileId: pid, slotAt: slot }).returning({ id: callBookings.id, slotAt: callBookings.slotAt });
    return NextResponse.json({ ok: true, booking: row });
  } catch {
    return NextResponse.json({ error: "That slot was just taken — pick another" }, { status: 409 });
  }
}
