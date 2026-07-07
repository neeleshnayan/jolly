/**
 * Fetch jobs from ATS public JSON boards — no HTML scraping, no ToS grey area.
 *   Greenhouse: https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
 *   Lever:      https://api.lever.co/v0/postings/<slug>?mode=json
 */
export type Source = "greenhouse" | "lever";

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

export function fetchBoard(source: Source, slug: string): Promise<FetchedJob[]> {
  return source === "greenhouse" ? greenhouse(slug) : lever(slug);
}
