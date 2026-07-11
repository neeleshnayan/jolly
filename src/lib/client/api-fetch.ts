/**
 * Client fetch with retry — the free-tier Cloudflare Worker mask.
 *
 * A cold Worker isolate's FIRST hit can hang (the runtime kills it → 500), but
 * that hit WARMS the isolate, so an immediate retry almost always wins. This
 * wraps fetch to retry on 5xx / network errors with a short backoff. The blend
 * logic + data stay server-side (Edge Function) — this only makes the round-trip
 * resilient. See docs/adr-001-ranking-funnel.md and the CF ranking memory.
 *
 * Use for idempotent GETs (and safe-to-repeat POSTs). Do NOT use for streaming,
 * SSE, websockets, or non-idempotent mutations — pass through plain fetch there.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit & { retries?: number },
): Promise<Response> {
  const retries = init?.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      // 5xx is the cold-isolate hang signature — retry (the failed hit warmed it).
      // Any other status is a "real" answer; return it.
      if (res.status >= 500 && attempt < retries) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      // network/abort — retry unless it's the last attempt
      lastErr = e;
      if (attempt < retries) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
