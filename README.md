# drizzle — a career copilot that knows you

> *The first rain after the drought — action over inaction.*

drizzle understands who you're becoming, then aligns every role, the mentors
ahead of you, and your next move to where you're headed — honestly, for the whole
climb. Not a keyword-matcher. A copilot that reads your trajectory and works the
whole search on your behalf.

**Product thesis:** *understand once, exploit many.* One deep read of a person —
their résumé, a short mentor voice call, the paths they try on — powers everything
downstream: honestly-ranked roles, a mentor who remembers, and a one-click apply
kit. A JD is not a direction; we match on **trajectory** (role family + domain +
altitude), not spelling.

---

## The pipeline (how a job becomes a ranked match)

```
fetch (cheap, no GPU)  →  extract (gemma4, local GPU)  →  embed (bge-m3)  →  rank (funnel)
   board APIs              structured facts + skills       1024d vectors      filter → align → blend
```

1. **Fetch** — pull postings from Greenhouse / Lever / Ashby / Workday / YC / a16z.
   Cheap; runs anytime.
2. **Extract** — a local model (**gemma4:26b** on a 4090) pulls structured facts:
   title, skills, seniority, domain, comp, credentials. Tiered + resumable.
3. **Embed** — **bge-m3** (1024d) turns "what a role *is*" and "where a person is
   *heading*" into comparable vectors. Same model both sides so cosines are honest.
4. **Rank** — a funnel: hard-filter (credentials, years) → semantic align
   (trajectory) → blended score (evidence + trajectory + desire, learned per-user
   drift from your applies/dismissals). See [`docs/adr-001-ranking-funnel.md`](./docs/adr-001-ranking-funnel.md).

Then: **mentor** (a voice call that reads who you're becoming and retunes the
ranking toward what you discussed), **explored paths** (every direction you try on,
saved + committable), and the **apply kit** (tailored résumé + letter + answers,
staged the moment you click apply).

---

## Architecture: compute where the data lives

The hard constraint that shaped everything: **one 4090 can't serve 100 concurrent
users, and new signups need instant results.** So:

- **Bulk, heavy, offline work** (extraction, pool embedding) runs **local** on the
  GPU — free, unlimited, no per-token cost.
- **Per-user, real-time work** (ranking blend, résumé vision, mentor, direction
  embedding) runs **in-region / in the cloud**, next to the data or on a Worker.
- **The ranking blend** runs in a **Supabase Edge Function** (`supabase/functions/rank`)
  — where the pgvector data lives — sharing pure math (`rank-core.ts`) with the
  Node path. The Worker just fetches it; it never scores hundreds of roles itself.
- **Client devices do what they can** — PDF export (`window.print()`), live ATS
  keyword matching, résumé metrics — all byte-identical to the server, at zero cost.

### The dev / prod demarcation — **one switch: `DEPLOY_TARGET`**

Everything keys off a single environment signal so the two worlds never bleed:

| Concern        | **localhost** (dev)              | **Cloudflare** (prod)                          |
|----------------|----------------------------------|------------------------------------------------|
| LLM            | **ollama** (local, free)         | **OpenRouter** — `gemma-4:free`                |
| Embeddings     | **ollama** `bge-m3` (bulk pool)  | **OpenRouter** `bge-m3` (real-time query)      |
| Voice          | local voicebox / Deepgram raw    | Deepgram (raw-key fallback, `DEEPGRAM_ALLOW_RAW`) |
| Local fallback | on                               | **off** (no ollama in a Worker → would 1003)   |
| Ranking        | Node (`rankMatchesWithMeta`)     | Supabase Edge fn (`rankViaEdge`)               |

`getProvider()` and `withLocalFallback()` ([`src/llm/index.ts`](./src/llm/index.ts))
**derive** their defaults from `DEPLOY_TARGET` — you don't set a provider per
environment; the switch does it. Explicit `LLM_PROVIDER` still overrides. The two
vector spaces are identical (`ollama bge-m3` vs `OpenRouter bge-m3` cosine = **1.0000**),
so the pool (embedded locally) and a live query (embedded in the cloud) match.

**Why not just Cloudflare Workers AI?** The free tier is 10k neurons/day — one bulk
backfill drains it, and it's shared across vision + embeds + LLM. OpenRouter's free
Gemma-4 and near-free bge-m3 sidestep the cap entirely, on a vendor already in use.

---

## Stack

- **Next.js 15** (App Router) on **OpenNext → Cloudflare Workers** (prod) / `next dev` (local)
- **Supabase** — Postgres + **pgvector** (HNSW, cosine), auth, Edge Functions, Hyperdrive
- **Drizzle ORM** — typed SQL, readable migrations
- **ollama** (gemma4:26b extraction, bge-m3 embeddings) on a local 4090
- **OpenRouter** (Gemma-4 LLM + bge-m3 embeddings) for per-user cloud compute
- **Deepgram** Voice Agent for the live mentor call

## Repository layout

```
src/
  app/              Next.js App Router — pages + API routes
    api/            route handlers: resume · opportunities · mentor · admin · auth · voice
    dashboard/      recommendations · explored paths · kanban · apply kit
    resume/         the editor + print view          admin/  operator control room
  agents/           LLM agents (extractor, bullet-refiner, redesigner, probes) + runAgent
  lib/
    extraction/     parse.ts (unpdf/mammoth) · vision.ts · extract.ts
    opportunities/  recommend.ts (Node) · rank-core.ts (pure, shared w/ Edge) · learn.ts
    embeddings.ts   nomic + bge-m3 (local ollama / OpenRouter)
    jobs/           fetch · vectorize (gemma4) · embed-bge (bge-m3 pool)
    scoring/ auth/ client/    scoring vector · LinkedIn OIDC + session · browser compute
  llm/              provider abstraction (ollama · openrouter · cloudflare · anthropic)
  db/               Drizzle schema + scoped clients
supabase/functions/rank/     the Edge ranker (imports the bundled rank-core)
tools/              harnesses + one-off ops scripts (run via `npx tsx`)
scripts/            cf-deploy.mjs · dev-clean.mjs        worker/  job-fetch worker
```

## Data model (the spine)

In [`src/db/schema.ts`](./src/db/schema.ts). One principle: **separate the immutable
from the derivable, and trace everything to a source.**

| Layer | Tables | Role |
|-------|--------|------|
| Sources | `sources` | append-only evidence (upload, edits, calls) — the replay trail |
| Résumé facts | `profiles`, `experiences`, `education`, `skills`, `projects` | the editable spine |
| The map | `insights` | soft/inferred, filled by the mentor over time |
| Opportunities | `opportunities` | the job pool — facts + `embedding_vec` (nomic) + `embedding_bge` (bge-m3) |
| Trajectory | `explored_paths`, `resume_themes` | directions tried on + the committed target |
| Signals | `opportunity_signals`, `agent_runs` | per-user ranking drift + agent observability |

## The agent system

LLM work goes through small, pure **agents** ([`src/agents/`](./src/agents/)) wrapped by
[`runAgent`](./src/agents/run.ts), which logs every call to `agent_runs` (model, tokens,
cost, duration) for the admin ROI view. Agents call `getProvider()` — never a hardcoded
model — so they follow the dev/prod demarcation automatically.

- `resume-extractor` — résumé text/images → structured `ResumeExtraction`
- `bullet-refiner` — sharpen/condense bullets (powers the redesign + editor AI)
- `resume-redesigner` — a new visual style sized to the condensed content
- `probe-generator` — the mentor's opening questions

## Setup

```bash
npm install
cp .env.example .env.local          # Supabase + provider keys
npm run db:push                     # apply schema to Postgres
npm run dev                         # local: ollama-backed
```

Needs a local **ollama** with `gemma4:26b` (extraction) + `bge-m3` (embeddings)
pulled, and a Supabase project (pooler + direct connection strings, API keys).

## Environment variables

Local dev reads `.env.local`; prod reads `wrangler.jsonc` `vars` + `wrangler secret`.
The one switch is **`DEPLOY_TARGET`** (`cloudflare` in prod, unset locally) — every
provider derives its default from it.

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres (pooled / direct) |
| `SESSION_SECRET` | session cookie + LinkedIn signed-state HMAC |
| `LINKEDIN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | OIDC sign-in |
| `LLM_PROVIDER` / `LLM_PROVIDER_MENTOR` | override the per-`DEPLOY_TARGET` provider default |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | cloud LLM + bge-m3 embeddings |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `EMBED_BGE_MODEL` | local models |
| `DEEPGRAM_API_KEY` / `DEEPGRAM_ALLOW_RAW` | mentor voice (raw-key fallback for prod) |
| `RESUME_VISION_PROVIDER` / `RESUME_PARSE` | vision transcription provider / enable |

Secrets (`*_KEY`, `*_SECRET`, `*_TOKEN`) go in `wrangler secret put`, never in `vars`.

**Before real users:** rotate any keys shared during development, remove the dev
`ALLOW_USER_PARAM` bypass, and confirm RLS + anon-grant revocation on all tables.

## Deploying to Cloudflare — the hard-won recipe

Two scripts encode every gotcha, so you never hand-run the dance:

```bash
npm run cf:deploy      # clean build + deploy (scripts/cf-deploy.mjs)
npm run dev:clean      # ALWAYS run this after a CF deploy, before `next dev`
```

A CF build shares `.next` with `next dev` and rewrites it with CF-variant
artifacts → `next dev` then throws `ENOENT _document.js` / missing-chunk errors and
**crash-loops** (which looks like GPU sawtooth — each failed request reloads the
model). `dev:clean` wipes the build dirs and starts dev fresh. The cure is always
the same.

`cf:deploy` ([`scripts/cf-deploy.mjs`](./scripts/cf-deploy.mjs)) exists because the
bare `opennextjs-cloudflare build && deploy` fails on Windows. Scars it handles, so
you don't re-earn them:
- **OpenNext hardcodes `.next`** — a custom `distDir` doesn't work; a CF build shares
  `.next` with `next dev` and corrupts it. Restart dev after a build.
- **Always wipe `.open-next`** before a fresh build — a stale aliases-off run poisons
  it (the phantom `canvas.node` bundling error).
- `DEPLOY_TARGET=cloudflare` **must** be set during build, or the CF aliases
  (puppeteer / canvas → empty) don't apply and the build fails.
- The deploy needs a Hyperdrive local connection string even though it's remote.
- **Vars-only change?** Re-run `deploy` alone (no rebuild) — it applies wrangler
  `vars` without touching a running crunch.
- Secrets (`DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `CF_API_TOKEN`, `SESSION_SECRET`)
  live in `wrangler secret`, never in `wrangler.jsonc`.

## Admin control room (`/admin`)

Operator-facing, local-only muscle: fetch jobs, run the tiered gemma4 crunch (with
live progress + stop), and drive **bge-m3 pool embedding** — coverage at a glance,
a row-count input, **drain-all** to embed the whole pool hands-off, and a per-row
**Embed** column + filter so you can find and fix stragglers. Built to be handed to
someone in ops.

## Testing

```bash
npx tsc --noEmit                 # types — the fast gate
npx tsx tools/anchors.ts         # frozen-fixture ranking regression (deterministic)
npx tsx tools/match-sanity.ts    # archetype profiles → expected top-K (live, needs DB)
npx tsx tools/test-gates.ts      # hard-requirement gates (credentials, years)
npm run build:rank-core          # verify the Edge ranker still bundles
```

Run the ranking harnesses (`anchors` + `match-sanity`) after **any scoring change** —
they catch drift the type checker can't. Other one-offs live in `tools/` (`test-geo`,
`test-learn`, `test-continuity`, `smoke-grounding`).

## Troubleshooting

| Symptom | Cause → fix |
|---------|-------------|
| `next dev`: `ENOENT _document.js` / missing chunks; GPU sawtooth | CF-corrupted `.next` → `npm run dev:clean` |
| CF build fails on `canvas.node` | stale `.open-next` from an aliases-off run → `cf:deploy` wipes it first |
| "No roles to match against yet" | the matches endpoint 500'd (check logs) — **not** an empty pool |
| Mentor voice dead on CF, greeting text shows | expired/low-role Deepgram key → `wrangler secret put DEEPGRAM_API_KEY` |
| "Ollama error 403 / 1003" on prod | a provider fell back to unreachable local ollama → confirm `LLM_PROVIDER=openrouter` on CF |
| CF AI `429` "neurons" | free-tier cap — all cloud compute is on OpenRouter now, so this shouldn't recur |

---

## Engineering ethos — how we built this

The principles we kept returning to, earned across the build:

1. **Compute where the data lives; offload where it's idle.** Heavy where it's
   free (the GPU, the Edge), real-time where it must be, and on the client when the
   client can (PDF, ATS, metrics). Save silicon, save cost.
2. **Free tiers, no vendor sprawl.** Every "just add a service" was resisted. The
   whole prod stack rides Supabase + Cloudflare + OpenRouter — vendors already in
   play. The neuron cap became a feature: it forced the cheaper, better path.
3. **A JD is not a direction.** We rank on trajectory, and the mentor mints a
   *thematic* direction tag (not the job title you clicked), timestamped, so a
   person's directions form a dated trail.
4. **Verify before claiming.** Every fix was exercised end-to-end — the drizzle
   array-cast bug, the 768-vs-1024 column, the bge-alignment cosine, the clean CF
   build. "It should work" was never allowed to stand in for "I watched it work."
5. **Honest scoring, honest UX.** A stationary calibration (not min-max within a
   user's batch), the one watch-out surfaced not buried, no phantom applications,
   no fabricated résumé metrics.
6. **Idempotent, resumable, observable.** Crunches resume per-row; agent runs are
   logged; migrations are `IF NOT EXISTS`. Nothing is a cliff.
7. **Diagnose the root, don't paper the symptom.** The CF "free plan can't run
   Next.js" panic was a stale-build red herring. The mentor "403" was a key-role
   issue, not a code one. The "Ollama 1003" on prod was a fallback chasing an
   unreachable host. Every time: chase the real cause.

---

*Built collaboratively, at pace, with care. It was a genuine pleasure. 🌦*
