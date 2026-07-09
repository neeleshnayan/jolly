import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import { getFullProfile } from "@/lib/profile/read";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) redirect("/login");

  const full = await getFullProfile(userId);
  const hasResume = Boolean(
    full &&
      (full.experiences.length ||
        full.education.length ||
        full.projects.length ||
        full.skills.length ||
        full.certifications.length),
  );
  return <DashboardClient userId={userId} name={full?.profile.fullName ?? null} hasResume={hasResume} />;
}
