/**
 * PATCH /api/profile/about — pin/unpin about-me facts. A key present in the
 * body pins that value; an explicit null unpins it (back to derivation).
 * Pinned values feed both the About display and the ranking gates.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { resolveUserId } from "@/lib/auth/user";
import type { AboutOverrides } from "@/lib/profile/about";

export const runtime = "nodejs";

const DEGREES = new Set(["phd", "md", "jd", "mba", "masters", "bachelors", "associate", "none"]);

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      u?: string;
      yearsExperience?: number | null;
      highestDegree?: string | null;
      currentEmployer?: string | null;
      trajectory?: string | null;
    };
    const userId = await resolveUserId(body.u);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const [p] = await db.select({ id: profiles.id, aboutOverrides: profiles.aboutOverrides }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

    const next = { ...((p.aboutOverrides ?? {}) as AboutOverrides) };
    const setOrClear = <K extends keyof AboutOverrides>(key: K, value: AboutOverrides[K] | null | undefined, valid: boolean) => {
      if (value === undefined) return; // not mentioned — leave as is
      if (value === null) delete next[key]; // explicit null — unpin
      else if (valid) next[key] = value;
    };
    setOrClear("yearsExperience", body.yearsExperience as number | null | undefined, typeof body.yearsExperience === "number" && body.yearsExperience >= 0 && body.yearsExperience <= 60);
    setOrClear("highestDegree", body.highestDegree as AboutOverrides["highestDegree"] | null | undefined, typeof body.highestDegree === "string" && DEGREES.has(body.highestDegree));
    setOrClear("currentEmployer", (typeof body.currentEmployer === "string" ? body.currentEmployer.slice(0, 120).trim() || null : body.currentEmployer) as string | null | undefined, typeof body.currentEmployer === "string");
    setOrClear("trajectory", (typeof body.trajectory === "string" ? body.trajectory.slice(0, 300).trim() || null : body.trajectory) as string | null | undefined, typeof body.trajectory === "string");

    await db.update(profiles).set({ aboutOverrides: next, updatedAt: new Date() }).where(eq(profiles.id, p.id));
    return NextResponse.json({ ok: true, overrides: next });
  } catch (err) {
    console.error("[/api/profile/about]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
