/**
 * GET /api/admin/metrics — the operator's numbers, admin-gated:
 *   1. mentor conversations (total + per user, with names)
 *   2. résumé edits (user_edit sources)
 *   3. applications sent
 *   4. agent runs by agent — count, errors, avg latency, tokens (the ROI view)
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth/admin";

export const runtime = "nodejs";

export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // SEQUENTIAL on purpose: parallel fan-out demanded 4+ fresh pool connections,
  // and the Supabase pooler path intermittently hangs new connects — one warm
  // socket doing 8 tiny queries is ~1s healthy and survives network flaps.
  const run = async <T,>(qs: Array<() => Promise<T>>) => {
    const out: T[] = [];
    for (const q of qs) out.push(await q());
    return out;
  };
  const [calls, callsByUser, edits, apps, agents, recentRuns, activity, byModel] = await run<unknown>([
    () => db.execute(sql`select count(*)::int as n from sources where kind = 'mentor_call'`),
    () => db.execute(sql`
      select coalesce(p.full_name, p.email, 'unknown') as who, count(*)::int as n, max(s.created_at) as last_at
      from sources s join profiles p on p.id = s.profile_id
      where s.kind = 'mentor_call'
      group by 1 order by n desc limit 20`),
    () => db.execute(sql`
      select count(*)::int as total,
             count(distinct profile_id)::int as users
      from sources where kind = 'user_edit'`),
    () => db.execute(sql`
      select count(*)::int as total,
             count(distinct a.profile_id)::int as users,
             count(*) filter (where a.applied_at > now() - interval '7 days')::int as last7
      from applications a`),
    () => db.execute(sql`
      select agent,
             count(*)::int as runs,
             count(*) filter (where status = 'error')::int as errors,
             round(avg(duration_ms))::int as avg_ms,
             coalesce(sum(input_tokens), 0)::int as tokens_in,
             coalesce(sum(output_tokens), 0)::int as tokens_out,
             max(created_at) as last_at
      from agent_runs
      group by agent order by runs desc`),
    () => db.execute(sql`
      select agent, status, model, duration_ms, error, created_at
      from agent_runs order by created_at desc limit 15`),
    // "active users" proxy until real session logging exists: a profile counts as
    // active if ANY of its rows (sources = uploads/edits/calls, agent runs) were
    // created in the window. Registered = total profiles.
    () => db.execute(sql`
      select
        (select count(distinct profile_id)::int from sources where created_at > now() - interval '1 day') as active_today,
        (select count(distinct profile_id)::int from sources where created_at > now() - interval '7 days') as active_week,
        (select count(*)::int from profiles) as registered,
        (select count(*)::int from profiles where created_at > now() - interval '7 days') as new_week`),
    // per-model token totals — multiplied by a price map client-side for est. $
    () => db.execute(sql`
      select coalesce(model, '(unlogged)') as model,
             count(*)::int as runs,
             coalesce(sum(input_tokens), 0)::int as tokens_in,
             coalesce(sum(output_tokens), 0)::int as tokens_out
      from agent_runs
      group by 1 order by runs desc`),
  ]);

  return NextResponse.json({
    ok: true,
    mentorCalls: { total: (calls as unknown as { n: number }[])[0]?.n ?? 0, byUser: callsByUser },
    resumeEdits: (edits as unknown as { total: number; users: number }[])[0] ?? { total: 0, users: 0 },
    applications: (apps as unknown as { total: number; users: number; last7: number }[])[0] ?? { total: 0, users: 0, last7: 0 },
    activity: (activity as unknown as { active_today: number; active_week: number; registered: number; new_week: number }[])[0] ?? null,
    byModel,
    agents,
    recentRuns,
  });
}
