/**
 * Pull a readable JD out of an arbitrary job-posting URL. ATS JSON APIs first
 * (clean text, immune to JS rendering); generic HTML strip as fallback; null
 * when the page has no readable prose (JS-rendered SPAs strip down to
 * minified code — storing that would poison the vectorizer).
 * Shared by the bookmark feature and aggregator boards (a16z/Consider).
 */

/** Public-internet URLs only — the server fetches these, so private ranges
 *  would be an SSRF hole (fetch a cloud metadata endpoint, an internal admin
 *  panel…). Checked on the FIRST url and on EVERY redirect hop. */
export function urlAllowed(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h.endsWith(".local") ||
    h === "[::1]"
  )
    return null;
  return u;
}

/** fetch() that validates every redirect hop against urlAllowed (a public URL
 *  redirecting to 169.254.169.254 is the classic SSRF bypass). */
export async function fetchPublic(rawUrl: string, init?: RequestInit & { maxHops?: number }): Promise<Response | null> {
  let url = urlAllowed(rawUrl);
  const hops = init?.maxHops ?? 5;
  for (let i = 0; i <= hops && url; i++) {
    const res = await fetch(url.href, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      url = urlAllowed(new URL(loc, url).href);
      continue;
    }
    return res;
  }
  return null; // hop limit or a hop resolved to a private target
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', times: "×", trade: "™", reg: "®", copy: "©",
};

/** Decode HTML entities — named (&quot; &lt; &amp;…), decimal (&#39;) and hex
 *  (&#x2019;). JD sources (greenhouse especially) are riddled with these. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML → readable text: drop script/style, decode entities, THEN strip tags
 *  (decode first so entity-encoded tags like &lt;div&gt; also get removed). */
export const strip = (html: string) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " "),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Clean a JD that may ALREADY be stored with tags/entities (older rows,
 *  samples) — safe to run on plain text too. Use before display AND before
 *  keyword extraction so both see readable prose, not markup. */
export const cleanJd = (text: string): string => (text ? strip(text) : "");

export function looksLikeCode(text: string): boolean {
  const sample = text.slice(0, 4000);
  const symbols = (sample.match(/[{};=<>]/g) ?? []).length;
  const codeWords = (sample.match(/\b(function|var|const|return|typeof|=>)\b/g) ?? []).length;
  return symbols / sample.length > 0.04 || codeWords > 25;
}

/** Known ATS URLs → their public JSON API. Returns null when unrecognized. */
export async function fetchViaAts(u: URL): Promise<{ title: string; company: string; jd: string } | null> {
  // https://jobs.lever.co/<slug>/<posting-id>
  const lever = u.hostname === "jobs.lever.co" && u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (lever) {
    const r = await fetch(`https://api.lever.co/v0/postings/${lever[1]}/${lever[2]}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { text?: string; descriptionPlain?: string; lists?: { text?: string; content?: string }[] };
    const jd = (j.descriptionPlain ?? "") + (j.lists?.length ? "\n" + j.lists.map((l) => `${l.text ?? ""}: ${strip(l.content ?? "")}`).join("\n") : "");
    return { title: j.text ?? "Role", company: lever[1], jd };
  }
  // https://boards.greenhouse.io/<slug>/jobs/<id> or job-boards.greenhouse.io
  const gh = /(?:^|\.)greenhouse\.io$/.test(u.hostname) && u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (gh) {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: string; content?: string };
    return { title: j.title ?? "Role", company: gh[1], jd: strip(j.content ?? "") };
  }
  return null;
}

/** Best-effort JD text from any posting URL; null when nothing readable. */
export async function fetchJdFromUrl(rawUrl: string): Promise<string | null> {
  const u = urlAllowed(rawUrl);
  if (!u) return null;
  try {
    const ats = await fetchViaAts(u).catch(() => null);
    if (ats && ats.jd.length >= 200) return ats.jd.slice(0, 20_000);
    const res = await fetchPublic(u.href, {
      headers: { "user-agent": "Mozilla/5.0 (drizzle job fetch)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res?.ok) return null;
    const text = strip((await res.text()).slice(0, 500_000)).slice(0, 20_000);
    if (text.length < 200 || looksLikeCode(text)) return null;
    return text;
  } catch {
    return null;
  }
}
