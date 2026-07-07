/**
 * GET  /api/admin/jobs — every opportunity in the DB (admin's raw view).
 * DELETE /api/admin/jobs?id=<uuid> — remove one (bad scrape, stale posting).
 */
import { NextRequest, NextResponse } from "next/server";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const [rows, [{ n: pending }]] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        source: opportunities.source,
        title: opportunities.title,
        company: opportunities.company,
        location: opportunities.location,
        remote: opportunities.remote,
        compMin: opportunities.compMin,
        compMax: opportunities.compMax,
        domain: opportunities.domain,
        companyStage: opportunities.companyStage,
        url: opportunities.url,
        vectorizedAt: opportunities.vectorizedAt,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .orderBy(desc(opportunities.createdAt))
      .limit(500),
    db.select({ n: sql<number>`count(*)::int` }).from(opportunities).where(isNull(opportunities.vectorizedAt)),
  ]);
  return NextResponse.json({ ok: true, jobs: rows, pending });
}

export async function DELETE(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await db.delete(opportunities).where(eq(opportunities.id, id));
  return NextResponse.json({ ok: true });
}
