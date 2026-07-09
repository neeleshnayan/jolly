/**
 * /resume/print — a bare, server-rendered résumé (no editor chrome, no client JS
 * needed for content). Puppeteer loads this to produce a clean PDF. Reachable
 * with ?u= (used internally by /api/resume/pdf); session also works.
 */
import { getFullProfile } from "@/lib/profile/read";
import { getSessionUserId } from "@/lib/auth/session";
import ResumeSheet from "../ResumeSheet";

export default async function PrintPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; embed?: string }>;
}) {
  const { u, embed } = await searchParams;
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) return <main className="print-page">Not signed in.</main>;
  const data = await getFullProfile(userId);
  if (!data) return <main className="print-page">No résumé.</main>;

  // ?embed=1 → shown in the Apply Kit iframe (not puppeteer). Puppeteer adds the
  // page margins for the PDF; an on-screen preview must restore them itself, or
  // the content sits flush to the edges.
  return (
    <main className={`print-page${embed ? " print-embed" : ""}`}>
      <ResumeSheet data={data} />
    </main>
  );
}
