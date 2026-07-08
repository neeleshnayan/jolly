/**
 * POST /api/voice/queue — the call lane. { action: "join" | "beat" | "leave" }
 * join/beat are the same operation (idempotent + heartbeat); the client polls
 * it while waiting and beats during the call. leave releases immediately.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { joinOrBeat, leave } from "@/lib/voice/queue";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; action?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (body.action === "leave") {
    leave(userId);
    return NextResponse.json({ ok: true, state: "left" });
  }
  return NextResponse.json({ ok: true, ...joinOrBeat(userId) });
}
