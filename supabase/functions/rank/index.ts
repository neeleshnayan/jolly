// Supabase Edge Function: rank
// ---------------------------------------------------------------------------
// Runs the recommendation blend WHERE THE DATA LIVES. The Cloudflare Worker
// (free plan, 10ms CPU) can't score hundreds of roles; this Deno function, in
// the DB's region, calls the get_ranking_inputs RPC (one in-region round-trip)
// and runs the SAME rankFromInputs the Node app uses — bundled from
// src/lib/opportunities/rank-core.ts into ./_core.mjs (regenerate with
// `npm run build:rank-core`). Supabase Edge free tier: 500K invocations/mo,
// ~2s CPU each — 200x the Workers-free budget. See docs/adr-001-ranking-funnel.
//
// Auth: service-to-service. The Worker sends x-rank-secret; we compare against
// the RANK_SECRET function secret. Deployed with --no-verify-jwt.
// @ts-nocheck  (Deno runtime — typechecked by `deno`, excluded from Node tsc)
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
import { rankFromInputs } from "./_core.mjs";

const EMPTY = { matches: [], learning: { active: false, events: 0, confidence: 0 }, userSkillKeys: [] };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const secret = Deno.env.get("RANK_SECRET");
  if (secret && req.headers.get("x-rank-secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { userId?: string; trusted?: string[] };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const userId = body?.userId;
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  const trusted = Array.isArray(body?.trusted) ? body.trusted : [];

  // SUPABASE_DB_URL is injected into every Edge Function — the direct, in-region
  // connection to this project's Postgres. Fresh client per request, closed in
  // the finally; nothing lives across invocations.
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL"), { prepare: false, max: 3, idle_timeout: 20 });
  try {
    const t0 = Date.now();
    const rows = await sql`SELECT get_ranking_inputs(${userId}::uuid, ${trusted}::text[], null) AS inputs`;
    const inputs = rows[0]?.inputs;
    if (!inputs) return Response.json(EMPTY);
    // scoring vector is computed on résumé upload (needs the big model); the Edge
    // ranker only consumes the cached one. Missing → empty (the app recomputes).
    const base = inputs.profile?.scoring ?? null;
    if (!base) return Response.json({ ...EMPTY, note: "no scoring vector yet" });
    const outcome = rankFromInputs(inputs, base);
    return Response.json({ ...outcome, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
});
