/**
 * Fetch jobs from ATS public JSON boards — no HTML scraping, no ToS grey area.
 *   Greenhouse: https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
 *   Lever:      https://api.lever.co/v0/postings/<slug>?mode=json
 *   Consider:   https://jobs.<board>.com/api-boards/search-jobs (VC portfolio
 *               aggregators, e.g. a16z) — list is JSON; each job's JD is pulled
 *               from its applyUrl (usually Greenhouse/Lever underneath)
 */
import { fetchJdFromUrl } from "./jd";

export type Source = "greenhouse" | "lever" | "consider";

export type FetchedJob = {
  externalId: string;
  source: Source;
  company: string;
  title: string;
  url: string;
  location: string | null;
  jd: string;
};

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function greenhouse(slug: string): Promise<FetchedJob[]> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  if (!res.ok) throw new Error(`greenhouse ${slug}: ${res.status}`);
  const j = (await res.json()) as { jobs?: { id: number; title?: string; absolute_url?: string; location?: { name?: string }; content?: string }[] };
  return (j.jobs ?? []).map((job) => ({
    externalId: `greenhouse:${slug}:${job.id}`,
    source: "greenhouse" as const,
    company: slug,
    title: job.title ?? "",
    url: job.absolute_url ?? "",
    location: job.location?.name ?? null,
    jd: stripHtml(job.content ?? ""),
  }));
}

async function lever(slug: string): Promise<FetchedJob[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!res.ok) throw new Error(`lever ${slug}: ${res.status}`);
  const arr = (await res.json()) as {
    id: string;
    text?: string;
    hostedUrl?: string;
    categories?: { location?: string };
    descriptionPlain?: string;
    lists?: { text?: string; content?: string }[];
  }[];
  return (arr ?? []).map((job) => ({
    externalId: `lever:${slug}:${job.id}`,
    source: "lever" as const,
    company: slug,
    title: job.text ?? "",
    url: job.hostedUrl ?? "",
    location: job.categories?.location ?? null,
    jd:
      (job.descriptionPlain ?? "") +
      (job.lists?.length ? "\n" + job.lists.map((l) => `${l.text ?? ""}: ${stripHtml(l.content ?? "")}`).join("\n") : ""),
  }));
}

// Consider hosts one API per network; map board slug → host. Slugs double as
// the board id in the POST body.
const CONSIDER_HOSTS: Record<string, string> = {
  "andreessen-horowitz": "https://jobs.a16z.com",
};

async function consider(slug: string, opts?: { titleFilter?: RegExp; cap?: number }): Promise<FetchedJob[]> {
  const host = CONSIDER_HOSTS[slug];
  if (!host) throw new Error(`consider ${slug}: unknown board (add it to CONSIDER_HOSTS)`);
  const res = await fetch(`${host}/api-boards/search-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (drizzle job fetch)" },
    body: JSON.stringify({ meta: { size: 100, offset: 0 }, board: { id: slug, isParent: true }, query: { promoteFeatured: true } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`consider ${slug}: ${res.status}`);
  const j = (await res.json()) as {
    jobs?: { jobId?: string | number; title?: string; companyName?: string; companySlug?: string; applyUrl?: string; url?: string; locations?: string[]; remote?: boolean }[];
  };
  // the list is cheap; the JD costs one fetch per job — filter titles FIRST
  // and cap before spending those requests
  const wanted = (j.jobs ?? [])
    .filter((job) => job.applyUrl && job.title && (!opts?.titleFilter || opts.titleFilter.test(job.title)))
    .slice(0, opts?.cap ?? 30);

  const out: FetchedJob[] = [];
  // small batches — polite to the underlying ATSes, gentle on our own socket pool
  for (let i = 0; i < wanted.length; i += 5) {
    const batch = wanted.slice(i, i + 5);
    const jds = await Promise.all(batch.map((job) => fetchJdFromUrl(job.applyUrl!)));
    batch.forEach((job, k) => {
      const jd = jds[k];
      if (!jd) return; // nothing readable at the applyUrl — skip, don't store junk
      out.push({
        externalId: `consider:${slug}:${job.jobId}`,
        source: "consider" as const,
        company: job.companyName || job.companySlug || "startup",
        title: job.title ?? "",
        url: job.applyUrl ?? job.url ?? "",
        location: (job.remote ? ["Remote"] : []).concat(job.locations ?? []).join(" | ") || null,
        jd,
      });
    });
  }
  return out;
}

export function fetchBoard(source: Source, slug: string, opts?: { titleFilter?: RegExp; cap?: number }): Promise<FetchedJob[]> {
  return source === "greenhouse" ? greenhouse(slug) : source === "lever" ? lever(slug) : consider(slug, opts);
}
