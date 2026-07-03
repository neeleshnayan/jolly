# Career Co-Pilot

An AI mentor that knows you, tells you the truth, gives you your next move, and
opens doors — entered through the acute pain of a job search. See
[career-copilot-brief.md](./career-copilot-brief.md) for the full strategy.

## Stack

- **Next.js 15** (App Router)
- **Supabase** — Postgres, auth, blob storage, pgvector (later)
- **Drizzle ORM** — typed SQL, readable migrations

## The data model (the spine)

All of it lives in [`src/db/schema.ts`](./src/db/schema.ts). One principle:
**separate the immutable from the derivable, and trace everything to a source.**

| Layer | Tables | Role |
|-------|--------|------|
| 1 · Sources | `sources` | Immutable append-only log — evidence trail + replay path |
| 2 · Resume facts | `profiles`, `experiences`, `education`, `skills`, `projects` | Known shape → relational → the editable resume |
| 3 · The map | `insights` | Soft/inferred, evolving — filled by the mentor later |
| 4 · Projections | `resume_variants` | Aspiration-aligned variants generated from the profile |

## Setup

```bash
npm install
cp .env.example .env.local          # fill in Supabase + Anthropic keys
npm run db:generate                 # generate migration SQL from schema
npm run db:push                     # apply to your Supabase Postgres
npm run db:studio                   # inspect data
```

Create a Supabase project first, then grab the pooler + direct connection
strings (Project Settings → Database) and the API keys (Project Settings → API).

## Build order

- [x] **Data model** — the spine (`src/db/schema.ts`)
- [ ] **Resume drop-in** — upload → parse → extract (LLM, structured output) →
      populate Layer 2, stamped with a `source`
- [ ] **Editable template** — Next.js resume view over Layer 2; every edit writes
      an entity + a `user_edit` source
- [ ] Mentor call → fills Layer 3 (`insights`)
- [ ] Resume variants, opportunity filtering, website builder
