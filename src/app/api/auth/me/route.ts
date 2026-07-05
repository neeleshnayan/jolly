import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getSessionUserId } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ userId: null });
  const [p] = await db
    .select({ fullName: profiles.fullName, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return NextResponse.json({ userId, name: p?.fullName ?? null, avatarUrl: p?.avatarUrl ?? null });
}
