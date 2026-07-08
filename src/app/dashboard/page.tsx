import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import { getFullProfile } from "@/lib/profile/read";
import { getThemesWithVersions, listApplications } from "@/lib/track/persist";
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
  const { themes, untagged } = await getThemesWithVersions(userId);
  const applications = await listApplications(userId);

  // serialize dates for the client boundary
  const s = <T extends { createdAt?: Date; appliedAt?: Date; followUpAt?: Date | null }>(row: T) => ({
    ...row,
    ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
    ...(row.appliedAt ? { appliedAt: row.appliedAt.toISOString() } : {}),
    ...(row.followUpAt ? { followUpAt: row.followUpAt.toISOString() } : {}),
  });

  return (
    <DashboardClient
      userId={userId}
      name={full?.profile.fullName ?? null}
      avatarUrl={(full?.profile as { avatarUrl?: string | null } | undefined)?.avatarUrl ?? null}
      hasResume={hasResume}
      themes={themes.map((t) => ({ ...t, versions: t.versions.map(s) }))}
      untagged={untagged.map(s)}
      applications={applications.map(s)}
    />
  );
}
