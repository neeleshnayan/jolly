# Mentor: exploratory experience + living insight map — build spec

> **Status 2026-07-11:** ✅ **B1** (cards as doorways) · ✅ **A** (reconcile-on-extract + stance,
> no migration, safe-by-default) · ✅ **C** (explored-paths: `explored_paths` table created w/
> RLS+anon-revoke, persist dedup/bump/commit verified 4/4 vs real Postgres, GET/POST/PATCH API,
> capture wired into card dive, `ExploredPaths` dashboard section w/ commit gate) · ✅ **B2**
> (live rec seam: `detectDirection` 9/9 unit-tested, `detectDirectionRecs` reuses rankMatches,
> injected via `mentorTurn.extraBrief` + surfaced via new `{t:"cards"}` stream frame → client
> renders + dive-able; no B1 collision). **Exploration suite complete (B1·A·C·B2).**
> **Next: Deepgram Voice Agent → prod** (new `VOICE_PROVIDER=deepgram` call mode; spike = 90% of it).
> Deferred: A3/A4 (#99).

Three workstreams. **A** makes the map update its mind (and guards the profile from
exploration pollution); **B** turns the mentor into a path explorer; **C** makes the
exploration sticky. A is the foundation, B is the visible magic, C is retention.

Ties to thesis: understand-once / exploit-many; the mentor probes + offers alternatives;
free exploration is the funnel, committing to a path is the paid step-up.

---

## A. Reconcile-on-extract (living insight map) — folds in the 3 insight fixes

**Problem today:** `insight-extractor.ts` sees only the current transcript; `persistInsights`
inserts every finding as a fresh `active` row — never dedups, merges, or supersedes.
So the pile only grows, contradictions co-exist with equal weight, and nothing decays.
The schema already has `supersedesId` + `status="superseded"` — **unused**.

This one change fixes all three reported problems (contradiction/evolution, recency,
bloat) AND adds the exploration-vs-conviction guard.

### A1. Extractor becomes reconciling (`src/agents/insight-extractor.ts`)
Two inputs now: `{ transcript, currentInsights: {id, dimension, content, confidence}[] }`.
Output per insight gains a **mode** + **stance**:
```
{ dimension, content, confidence,
  mode: "new" | "reinforces" | "refines" | "contradicts",
  targetId?: string,            // existing insight this acts on (for the non-"new" modes)
  stance: "conviction" | "exploration" }
```
Prompt additions:
- Pass the current active insights (id + one-line each) as context.
- "Decide how each new finding relates to what we already know: brand new, reinforces an
  existing one, refines/sharpens it, or contradicts it (they changed / grew)."
- "Mark **stance**: conviction = who they ARE / want; exploration = a path they're merely
  sampling or curious about. Never let a sampled curiosity read as a settled trait."

### A2. Persist with supersession (`src/lib/insights/persist.ts`)
Per returned insight:
- `new` → insert `active`.
- `reinforces` → bump target confidence (toward max, recency-weighted), set `last_seen_at=now`; **no dup row**.
- `refines` / `contradicts` → insert new `active` with `supersedesId=targetId`; set target `status="superseded"`.
Superseded rows are KEPT (they power the "how the read evolved" trajectory) but excluded
from active scoring (map query already filters `status="active"`).

### A3. Recency / decay (`src/lib/scoring/profileText.ts` + `profile-scorer.ts`)
- `buildProfileText` already receives dated insights — surface **age + confidence + stance**
  to the scorer, and instruct: weight recent, high-confidence, **conviction** evidence
  most; treat exploration-stance as light/near-zero for the trait vector.
- Optional soft decay: effective_weight = confidence × recencyFactor(age) computed in
  buildProfileText, so even non-contradicted stale signals fade. (v1 can rely on
  supersession + stance; add decay if the pile still drifts.)

### A4. Dedup/merge
Mostly handled by A1's `reinforces` mode. Fallback (v2): near-duplicate merge within a
dimension via embedding/string similarity for ones the LLM misses.

### A5. Schema migration
`insights` table: add `stance text default 'conviction'`, `last_seen_at timestamptz`.
`supersedes_id` + `status` already exist. Small, additive migration.

**Cost:** extractor prompt grows (now carries current insights) but runs post-call
(SLOW PATH) — not latency-critical.

---

## B. Path cards as doorways + real-time recommendation seam

**Today:** role cards (`spectrumRef` / `getCallSpectrum`) and circle cards surface
reactively when the mentor *names* a role/person (#61/#62). They're display-only.
`capabilityBrief` (#29) already builds a role dossier when the user names a role.

### B1. Cards become doorways (`src/app/mentor/MentorCall.tsx` + a dossier route)
Make each card (`STRONG FIT / DIFFERENT PATH / A PIVOT`) clickable. Click →
- steer the next turn: inject a synthetic user intent *"Walk me through <role> at <company> —
  what would that path actually look like for me?"* and fire a turn, **and**
- render a **path dossier** card: what the role really is · which of YOUR skills transfer ·
  comp arc · the circle person who made that exact jump.
Dossier assembled from data we already have: `capabilityBrief` (role), `getCallSpectrum`
(fit), circle (`mentors/match` transitions), skills (transfer) + one focused LLM pass.
Mentor SPEAKS the dossier (streamed via turn-stream) while the structured card renders.

### B2. Real-time recommendation seam (`fetchRecommendations(direction, userId)`)
The mentor pulls fresh, real recs mid-conversation when the user expresses a *direction*
("I want to explore marketing").
- **Trigger (now):** deterministic direction-detection, extending `capabilityBrief`'s
  named-entity detection to broader directions (embedding/keyword over the turn).
- **Fetch:** query `recommend.ts` / `getCallSpectrum` re-ranked toward that direction,
  live, server-side during the turn.
- **Use:** inject fresh top-k into the turn context (mentor speaks about *real, current*
  roles) + surface them as cards.
- **Seam is swappable:** deterministic detector now (gemma4 can't tool-call reliably);
  swap to an LLM **tool call** (`fetch_recommendations`) once the brain is Claude — same
  `fetchRecommendations()` underneath. (Ties to the mentor-brain = Claude thread.)

---

## C. Explored-paths memory + comparison view (the sticky part)

**Goal:** each direction sampled becomes a saved branch; a compact comparison view brings
people back. "You've explored 3 — Analytics Engineer · Creative/Marketing · Founding Engineer."

### C1. Data (`explored_paths` table)
`{ id, profileId, label, seeded_from (insightId|role|card), summary jsonb
   {arc, comp_range, transfer_difficulty, first_move, circle_person}, created_at, last_visited_at }`.

### C2. Population
- On a B1 card dive-in → write/update an `explored_paths` row (the B1 dossier IS the summary).
- From A5 exploration-stance insights → seed a path branch.

### C3. Comparison UI (dashboard section and/or mentor post-call)
Chips of explored directions → expand a compact card each (arc · comp · transfer difficulty ·
first move · who did it). Actions: "continue exploring" (→ mentor dive) and the
monetization hook **"commit to this path"** (→ brokered intro + tailored apply kit).

**Shared artifact:** B1 generates the path dossier; C persists + compares it. Build B1's
dossier shape with C's storage in mind so they're the same object.

---

## Dependencies & sequencing

```
A5 stance tag ──guards──▶ B1/B2 exploration ──feeds──▶ C branches
A (reconcile) ──cleans──▶ the profile the whole thing writes to
```

- **A5 (stance tagging)** should land before exploration goes wide, or sampled curiosities
  harden into traits. It's a small slice of A.
- **B1** is the most demo-visible and is a contained change (reuses the dossier seam).
- **C** depends on B1's dossier artifact + A5's exploration stance.

### Recommended order
1. **B1 — cards as doorways** (visible magic; small; reuses `capabilityBrief`).
2. **A5 + A1/A2 — stance tag + reconcile-on-extract** (protects the profile; the insight fix-plan).
3. **B2 — live recommendation seam** (deterministic now; Claude tool-call later).
4. **C — explored-paths memory + comparison view**.
5. **A3/A4 — decay + dedup fallback** (tune once real data accumulates).

### Demo (≈2 days out) vs post-demo
- **Demo-worthy:** B1 (cards → live dives) + a light C (show explored-paths chips). This is
  the "wow, it explores WITH me" moment.
- **Substance / post-demo:** full A reconcile + decay, B2 live tool, C comparison depth.
  A5 stance tag is cheap enough to include pre-demo so demo exploration doesn't pollute.
