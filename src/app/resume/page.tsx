import { getFullProfile } from "@/lib/profile/read";
import ResumeEditor from "./ResumeEditor";

export default async function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;

  if (!u) {
    return (
      <main className="resume-wrap">
        <div className="resume">
          Missing user. <a href="/">Upload a résumé →</a>
        </div>
      </main>
    );
  }

  const data = await getFullProfile(u);
  if (!data) {
    return (
      <main className="resume-wrap">
        <div className="resume">
          No résumé found for this user. <a href="/">Upload one →</a>
        </div>
      </main>
    );
  }

  return <ResumeEditor userId={u} initial={data} />;
}
