/**
 * Local bge-m3 pool embedding — fills the `embedding_bge` (1024d) column on the
 * 4090 (free, no CF neuron cap). Same model CF runs for the real-time direction
 * embed, so pool-doc vs user-query cosines are comparable. Nomic's embedding_vec
 * is left untouched, so the current ranking keeps working while bge is populated.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embedBge, roleEmbedText } from "@/lib/embeddings";
import { TRUSTED_MODELS } from "@/lib/jobs/vectorize";

// TRUSTED_MODELS[0] is the current strong/fast model (gemma4:26b) — "needs
// gemma4 re-crunch" = not yet extracted by it (null / granite / older gemma).
const CURRENT_MODEL = TRUSTED_MODELS[0];

let running = false;
export function bgeRunning(): boolean {
  return running;
}

async function ensureColumn(): Promise<void> {
  await db.execute(sql`ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS embedding_bge vector(1024)`);
}

function firstRow<T>(res: unknown): T {
  return (Array.isArray(res) ? res[0] : (res as { rows: unknown[] }).rows[0]) as T;
}
function allRows<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as T[];
}

export async function bgeCounts(): Promise<{ gemma4Needed: number; bgeNeeded: number; total: number; running: boolean }> {
  await ensureColumn();
  const g = await db.execute(
    sql`SELECT count(*)::int AS n FROM opportunities WHERE vectorize_model IS NULL OR vectorize_model <> ${CURRENT_MODEL}`,
  );
  const b = await db.execute(
    sql`SELECT count(*)::int AS n FROM opportunities WHERE embedding_bge IS NULL AND vectorized_at IS NOT NULL`,
  );
  // total = extracted rows (bge-eligible); coverage = total - bgeNeeded
  const t = await db.execute(sql`SELECT count(*)::int AS n FROM opportunities WHERE vectorized_at IS NOT NULL`);
  return {
    gemma4Needed: firstRow<{ n: number }>(g).n ?? 0,
    bgeNeeded: firstRow<{ n: number }>(b).n ?? 0,
    total: firstRow<{ n: number }>(t).n ?? 0,
    running,
  };
}

type PoolRow = { id: string; title: string | null; domain: string | null; facts: Record<string, unknown> | null };

function textFor(r: PoolRow): string {
  const f = (r.facts ?? {}) as { summary?: string; must_have_skills?: string[]; domain?: string };
  // bge is symmetric — strip nomic's "search_document:" prefix so query↔doc match
  return roleEmbedText({ title: r.title ?? undefined, summary: f.summary, must_have_skills: f.must_have_skills, domain: r.domain ?? f.domain }, r.title)
    .replace(/^search_document:\s*/, "");
}

/** Embed up to `limit` un-bge'd rows, `batch` per model call. Returns how many
 *  were embedded and how many still remain (so the UI can loop). */
export async function runBgeEmbed({ limit = 100, batch = 16 }: { limit?: number; batch?: number } = {}): Promise<{ embedded: number; remaining: number }> {
  if (running) throw new Error("A bge embed run is already in progress");
  running = true;
  try {
    await ensureColumn();
    const res = await db.execute(
      sql`SELECT id, title, domain, facts FROM opportunities WHERE embedding_bge IS NULL AND vectorized_at IS NOT NULL ORDER BY vectorized_at DESC NULLS LAST LIMIT ${limit}`,
    );
    const rows = allRows<PoolRow>(res);
    let embedded = 0;
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      const vecs = await embedBge(slice.map(textFor));
      for (let j = 0; j < slice.length; j++) {
        const v = vecs[j];
        if (!v?.length) continue;
        await db.execute(sql`UPDATE opportunities SET embedding_bge = ${`[${v.join(",")}]`}::vector WHERE id = ${slice[j].id}`);
        embedded++;
      }
    }
    const rem = await db.execute(
      sql`SELECT count(*)::int AS n FROM opportunities WHERE embedding_bge IS NULL AND vectorized_at IS NOT NULL`,
    );
    return { embedded, remaining: firstRow<{ n: number }>(rem).n ?? 0 };
  } finally {
    running = false;
  }
}
