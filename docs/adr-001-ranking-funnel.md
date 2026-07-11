# ADR-001: Ranking funnel — filter → vector align → blend, computed where the data lives

**Status:** Proposed
**Date:** 2026-07-12
**Deciders:** Neelesh

## Context

- Ranking currently scores a 500-row window of the pool in TypeScript per request. The pool grows with every crunch (~1,470 rows now, thousands soon); score-everything degrades linearly.
- Cloudflare Workers **Free plan (10ms CPU)** kills the current ranking request (parse ~1–2MB + score 427 roles ≈ hundreds of ms CPU). Constraint: **no new vendors, avoid the $5/mo if reasonable**.
- Assets already in place: `get_ranking_inputs` RPC (one-round-trip gather), pgvector + HNSW index on `opportunities.embedding_vec` (nomic-768), validated TS blend (anchors 25/25 + match-sanity).
- The direction (target role) embedding needs nomic — which lives only on the ingestion box (4090). CF must never depend on the box for availability.

## Decision (proposed)

Three-stage funnel, each stage where it's cheapest:

1. **FILTER (Postgres, in the RPC):** visibility, trusted-model, vectorized, dismissed, and (later, #94) active/fresh. Cheap set reduction that needs no user nuance.
2. **ALIGN (Postgres, pgvector):** when a stored direction vector exists → `ORDER BY embedding_vec <=> :direction LIMIT K₁` (HNSW = O(log N), constant as the pool grows). **Candidate UNION** to avoid the funnel trap (below): top-K₁ by alignment **∪ top-K₂ by recency** (evidence-strong roles that share no direction language must survive to the blend).
3. **RANK (TypeScript blend on ~K=100–150 rows):** the validated blend — desire/evidence/trajectory + comp/location refinements + hard gates — unchanged, just on K rows instead of N. Runs in a **Supabase Edge Function** (Deno TS → reuses blend/match/gates/canon nearly verbatim); the CF Worker makes one `fetch()` and does ~zero CPU.

Direction vector: written by the ingestion box (sweep: profiles whose target_role changed → embed with nomic → store `profiles.direction_vec vector(768)`). **Degrades, never blocks:** no direction vector → stage 2 falls back to recency window (today's behavior) and the blend's lexical trajectory covers it. New signups get instant (non-semantic) recs; semantic alignment kicks in when the sweep catches up (~seconds when the box is on).

## Options considered

### A. Status quo (score-everything in the CF Worker)
| Dimension | Assessment |
|---|---|
| Complexity | none (exists) | Cost | free plan **fails** (10ms CPU) | Scalability | O(N) — degrades every crunch | Risk | already broken on CF |

### B. Funnel + Edge Function ranking ← **recommended**
| Dimension | Assessment |
|---|---|
| Complexity | Medium — RPC gains funnel params; blend code ported to Deno (same TS) |
| Cost | **$0** (Supabase Edge Functions: 500K invocations/mo free, ~2s CPU each — 200× the Workers-free budget) |
| Scalability | O(K) — constant as pool grows; HNSW handles the N |
| Team familiarity | High — it's the same TS blend, moved |

**Pros:** free; "compute where the data lives" completed; pool can grow 100×; harnesses can validate outcome parity; Mumbai region move later stacks cleanly (cuts the remaining ocean hop).
**Cons:** one more deploy artifact (the function); two copies of blend code to keep in sync (mitigate: move blend/gates/canon to a shared, dependency-free `src/lib/ranking-core/` imported by both).

### C. Full SQL ranking (port the blend into Postgres)
Best perf, but re-implements validated logic in another language — high drift risk, days of re-validation. Rejected for now.

### D. Client-side ranking
Free, but ships the scoring IP + 1–2MB to every browser. Rejected.

### E. Pay $5/mo (Workers Paid)
1-minute unblock, 30s CPU. Still on the table as the pragmatic bridge — orthogonal to the funnel, which is worth building regardless.

## The funnel trap (and why the union)

A hard vector cut at stage 2 silently drops roles that would have **won the blend on evidence + desire** despite weak direction-language similarity (e.g., a perfect-skills-match role phrased differently than the target). Today's blend renormalizes and lets such roles rank. Mitigation: candidate union (alignment ∪ recency), K per leg tuned by the harnesses — anchors + match-sanity must stay green, that's the acceptance bar.

## Consequences

- Easier: pool growth (no per-request cost), free-tier CF, future Mumbai move, per-user precompute later if wanted.
- Harder: blend code lives in a shared package consumed by two runtimes; Edge Function deploy joins the release ritual.
- Revisit: K values as the pool passes ~10K; gte-small (Supabase's built-in embedder) as a nomic replacement to drop the box dependency for direction vectors entirely.

## Action items
1. [ ] Neelesh: Supabase access token (for CLI deploys) + keys into `.env.local`
2. [ ] Extract `ranking-core` (blend/match/gates/canon — pure TS, no node deps)
3. [ ] RPC v2: funnel params (K₁ alignment, K₂ recency, union) + trimmed facts
4. [ ] `profiles.direction_vec` + ingestion-box sweep (embed on target change)
5. [ ] Edge Function `rank`: RPC → blend on K → top-N JSON; CF Worker fetches it
6. [ ] Harness parity: anchors 25/25 + match-sanity green through the funnel
