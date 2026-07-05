import { redirect } from "next/navigation";
import { getFullProfile } from "@/lib/profile/read";
import { getSessionUserId } from "@/lib/auth/session";
import ResumeEditor from "./ResumeEditor";
import UploadResume from "../UploadResume";
import StartOptions from "./StartOptions";

export default async function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; scratch?: string }>;
}) {
  // session-first; ?u= still works for dev/share links
  const { u, scratch } = await searchParams;
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) redirect("/login");

  const data = await getFullProfile(userId);
  const hasResume = Boolean(
    data &&
      (data.experiences.length ||
        data.education.length ||
        data.projects.length ||
        data.skills.length ||
        data.certifications.length),
  );

  // no profile row at all (dev ?u= with a fresh id) → just upload
  if (!data) {
    return (
      <main className="upload-wrap">
        <UploadResume userId={userId} />
      </main>
    );
  }

  // empty résumé → import a file, start blank, or fork an existing version
  if (!hasResume && scratch !== "1") {
    return (
      <main className="upload-wrap">
        <UploadResume userId={userId} />
        <StartOptions userId={userId} />
      </main>
    );
  }

  return <ResumeEditor userId={userId} initial={data} />;
}
