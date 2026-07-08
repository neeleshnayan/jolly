/**
 * Pull a readable JD out of an arbitrary job-posting URL. ATS JSON APIs first
 * (clean text, immune to JS rendering); generic HTML strip as fallback; null
 * when the page has no readable prose (JS-rendered SPAs strip down to
 * minified code — storing that would poison the vectorizer).
 * Shared by the bookmark feature and aggregator boards (a16z/Consider).
 */

export const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  try {
    const ats = await fetchViaAts(u).catch(() => null);
    if (ats && ats.jd.length >= 200) return ats.jd.slice(0, 20_000);
    const res = await fetch(u.href, {
      headers: { "user-agent": "Mozilla/5.0 (drizzle job fetch)" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const text = strip((await res.text()).slice(0, 500_000)).slice(0, 20_000);
    if (text.length < 200 || looksLikeCode(text)) return null;
    return text;
  } catch {
    return null;
  }
}
