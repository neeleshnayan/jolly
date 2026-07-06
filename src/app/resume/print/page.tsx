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
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) return <main className="print-page">Not signed in.</main>;
  const data = await getFullProfile(userId);
  if (!data) return <main className="print-page">No résumé.</main>;

  return (
    <main className="print-page">
      <ResumeSheet data={data} />
    </main>
  );
}
