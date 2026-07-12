/**
 * Semantic trajectory via embeddings — the ONE home for turning "who this role
 * is" and "where this person is heading" into vectors and a 0–1 alignment
 * score. Replaces the lexical word-overlap trajectory: a Forward-Deployed
 * Engineer role that shares zero words with "architect foundational systems"
 * now still reads as on-direction, because meaning ≠ spelling.
 *
 * Model: nomic-embed-text (768d, local, ~50ms). It's ASYMMETRIC — it wants a
 * "search_query:" prefix on the intent and "search_document:" on the corpus;
 * skipping that quietly halves quality (learned the hard way in tools/test-*).
 *
 * The cos→score mapping is FIXED (calibrated from the pool), not relative to a
 * user's own batch: a min-max within one person's matches would stretch their
 * best result to 1.0 even when everything they see is mediocre. Honest scoring
 * needs a stationary scale.
 */
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

// nomic query↔document cosines cluster tight and high; these bounds map the
// real signal band → 0..1. Calibrated 2026-07-10 from tools/embed-lock across 5
// varied directions × the whole pool: distribution min 0.50 / p25 0.63 /
// median 0.66 / p90 0.73 / max 0.86. LO≈p25 (off-direction floors at 0.5),
// HI=0.80 so only genuinely-perfect matches saturate and the dense 0.66–0.80
// band spreads across the trajectory range. Re-run embed-lock after any change
// to roleEmbedText and re-tune.
const COS_LO = Number(process.env.EMBED_COS_LO ?? 0.62);
const COS_HI = Number(process.env.EMBED_COS_HI ?? 0.8);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Batch-embed. Returns one 768d vector per input, in order. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  // On Cloudflare, Ollama/nomic is unreachable (no localhost) and the pool is
  // nomic-embedded, so a CF embedding model would be a different vector space
  // anyway. Fail FAST here (a 30s hang to localhost gets the Worker killed) →
  // ranking uses its lexical trajectory fallback.
  if (process.env.DEPLOY_TARGET === "cloudflare") {
    throw new Error("embeddings unavailable on Cloudflare — lexical fallback");
  }
  const r = await fetch(`${BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  return ((await r.json()) as { embeddings: number[][] }).embeddings;
}

// bge-m3 (1024d) — the model we run BOTH sides so cosines are comparable: local
// ollama for bulk pool embedding (free, on the 4090), CF Workers AI for the
// real-time per-user direction embed (CF has no ollama). bge is symmetric — no
// search_query/document prefixes (unlike nomic), so callers pass plain text.
const BGE_MODEL = process.env.EMBED_BGE_MODEL ?? "bge-m3"; // ollama tag
const OR_BGE_MODEL = process.env.OPENROUTER_BGE_MODEL ?? "baai/bge-m3"; // OpenRouter slug

/** Batch-embed with bge-m3 → 1024d vectors (the `embedding_bge` column). Cloud
 *  path is OpenRouter (same model as the local pool → comparable cosines, and it
 *  sidesteps CF's Workers-AI neuron cap); local path is ollama. Routes to
 *  OpenRouter on CF (no ollama there) or when EMBED_PROVIDER=openrouter. */
export async function embedBge(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const useOpenRouter = process.env.EMBED_PROVIDER === "openrouter" || process.env.DEPLOY_TARGET === "cloudflare";
  if (useOpenRouter) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OpenRouter bge: OPENROUTER_API_KEY missing");
    const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: OR_BGE_MODEL, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`openrouter bge ${r.status}: ${(await r.text()).slice(0, 150)}`);
    const j = (await r.json()) as { data: { embedding: number[]; index: number }[] };
    return j.data.slice().sort((a, b) => a.index - b.index).map((d) => d.embedding); // preserve input order
  }
  const r = await fetch(`${BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: BGE_MODEL, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`bge embed ${r.status}`);
  return ((await r.json()) as { embeddings: number[][] }).embeddings;
}

/** The text that REPRESENTS a role for trajectory matching — what it IS, not
 *  its rubric scores. Title + plain-English summary + skills. */
export function roleEmbedText(facts: { title?: string; summary?: string; must_have_skills?: string[]; domain?: string }, title?: string | null): string {
  const t = title || facts.title || "";
  const skills = (facts.must_have_skills ?? []).slice(0, 10).join(", ");
  return `search_document: ${t}. ${facts.domain ?? ""} ${facts.summary ?? ""} ${skills ? `Skills: ${skills}` : ""}`.replace(/\s+/g, " ").trim();
}

/** The user's DIRECTION as natural text — the target role they set with their
 *  mentor plus their aspiration/value stances. Empty string → no direction. */
export function directionEmbedText(target: string | null | undefined, aspirations: string[]): string {
  const bits = [target && `Target role: ${target}.`, ...aspirations].filter(Boolean);
  return bits.length ? `search_query: ${bits.join(" ")}`.replace(/\s+/g, " ").trim() : "";
}

export function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? d / denom : 0;
}

/** cosine → the 0.5–1 trajectory band (same shape trajectoryFit produced), via
 *  the FIXED calibration. Below the floor still reads 0.5 (a miss dents, never
 *  buries), dead-on reads ~1.0. */
export function trajectoryFromCosine(cos: number): number {
  return 0.5 + 0.5 * clamp01((cos - COS_LO) / (COS_HI - COS_LO));
}

export const EMBED_CALIBRATION = { COS_LO, COS_HI, MODEL };
