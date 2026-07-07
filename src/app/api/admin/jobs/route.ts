/**
 * GET  /api/admin/jobs — PAGED view of the job pipeline (a 500-row dump once
 *       crashed a browser tab; never again). ?status=all|pending|vectorized,
 *       ?q=<search>, ?limit, ?offset. Includes distribution stats so the
 *       operator can see which verticals/boards are thin and fetch more of
 *       what's missing.
 * DELETE /api/admin/jobs?id=<uuid> — remove one (bad scrape, stale posting).
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, isNull, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";

// Title-based vertical buckets — works for ALL rows, vectorized or not, so the
// coverage picture is complete before any GPU is spent. Order matters: the
// first match wins ("Product Designer" → Design, "Account Manager" → Sales).
const VERTICALS: [string, string][] = [
  ["Legal", "counsel|attorney|legal|paralegal|contracts|compliance"],
  ["Health", "physician|doctor|clinical|nurse|medical|health|therapist"],
  ["Design", "design|\\mux\\M|\\mui\\M|creative|visual|brand"],
  ["Engineering", "engineer|developer|software|architect|devops|infra|platform|\\mai\\M|\\mml\\M|machine learning"],
  ["Research & Data", "research|scientist|\\mdata\\M|analyst|analytics"],
  ["Content & Marketing", "writer|content|marketing|growth|editor|communications"],
  ["Sales & Community", "sales|account|success|support|partnership|community"],
  ["Product & Ops", "product|program|project|manager|operations|strategy|chief of staff"],
  ["Finance & People", "finance|accountant|people|talent|recruit|payroll"],
];

function verticalCase(): SQL<string> {
  const whens = VERTICALS.map(([name, re]) => sql`when title ~* ${re} then ${name}`);
  return sql<string>`case ${sql.join(whens, sql` `)} else 'Other' end`;
}

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const p = req.nextUrl.searchParams;

  // detail mode: everything the model extracted for one job
  const detailId = p.get("id");
  if (detailId) {
    const [row] = await db.select().from(opportunities).where(eq(opportunities.id, detailId)).limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, facts: row.facts, vector: row.vector, jdChars: (row.rawText ?? "").length });
  }

  const status = p.get("status") ?? "all";
  const q = (p.get("q") ?? "").trim();
  const limit = Math.min(100, Math.max(10, Number(p.get("limit") ?? 50)));
  const offset = Math.max(0, Number(p.get("offset") ?? 0));

  const conds: SQL[] = [];
  if (status === "pending") conds.push(isNull(opportunities.vectorizedAt));
  if (status === "vectorized") conds.push(isNotNull(opportunities.vectorizedAt));
  if (q) conds.push(or(ilike(opportunities.title, `%${q}%`), ilike(opportunities.company, `%${q}%`))!);
  const where = conds.length ? and(...conds) : undefined;

  // sequential on one warm socket (see metrics route — the pooler punishes
  // parallel cold connects on this network)
  const rows = await db
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
    .where(where)
    // the vectorized tab answers "what did the model just process?" — order by
    // WHEN IT WAS VECTORIZED, not when it was fetched (freshly processed old
    // fetches were hiding at the bottom)
    .orderBy(status === "vectorized" ? desc(opportunities.vectorizedAt) : desc(opportunities.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(opportunities).where(where);
  const [{ n: pending }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(isNull(opportunities.vectorizedAt));

  // distribution stats (whole pipeline, not the current page/filter)
  const verticals = await db
    .select({
      vertical: verticalCase(),
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where vectorized_at is not null)::int`,
    })
    .from(opportunities)
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`);
  const boards = await db
    .select({
      company: opportunities.company,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where vectorized_at is not null)::int`,
    })
    .from(opportunities)
    .groupBy(opportunities.company)
    .orderBy(sql`2 desc`)
    .limit(20);

  return NextResponse.json({ ok: true, jobs: rows, total, pending, stats: { verticals, boards } });
}

export async function DELETE(req: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await db.delete(opportunities).where(eq(opportunities.id, id));
  return NextResponse.json({ ok: true });
}
