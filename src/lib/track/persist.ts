/**
 * Themes → Versions → Applications → Outcome-events. The tracking spine:
 * a theme is a strategic angle, a version is a frozen résumé snapshot under it,
 * an application records where a version was sent, and events are the funnel.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  experiences,
  education,
  skills,
  projects,
  sources,
  resumeThemes,
  resumeVersions,
  applications,
  applicationEvents,
} from "@/db/schema";
import { getFullProfile } from "@/lib/profile/read";

async function profileIdFor(userId: string): Promise<string> {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) throw new Error("Profile not found");
  return p.id;
}

// ---- themes ----
export async function createTheme(userId: string, name: string, latentAttributes: Record<string, unknown> = {}) {
  const pid = await profileIdFor(userId);
  const [row] = await db
    .insert(resumeThemes)
    .values({ profileId: pid, name, latentAttributes })
    .returning();
  return row;
}

export async function listThemes(userId: string) {
  const pid = await profileIdFor(userId);
  return db.select().from(resumeThemes).where(eq(resumeThemes.profileId, pid)).orderBy(asc(resumeThemes.createdAt));
}

// ---- versions ----
/** Snapshot the user's current résumé (content + style) as a version. */
export async function createVersion(
  userId: string,
  opts: { themeId?: string; hypothesis?: string; label?: string },
) {
  const pid = await profileIdFor(userId);
  const full = await getFullProfile(userId);
  if (!full) throw new Error("Profile not found");
  const [row] = await db
    .insert(resumeVersions)
    .values({
      profileId: pid,
      themeId: opts.themeId ?? null,
      hypothesis: opts.hypothesis ?? null,
      label: opts.label ?? null,
      content: full as unknown as Record<string, unknown>,
    })
    .returning({ id: resumeVersions.id, createdAt: resumeVersions.createdAt });
  return row;
}

export async function listVersions(userId: string) {
  const pid = await profileIdFor(userId);
  return db
    .select({
      id: resumeVersions.id,
      themeId: resumeVersions.themeId,
      label: resumeVersions.label,
      hypothesis: resumeVersions.hypothesis,
      createdAt: resumeVersions.createdAt,
    })
    .from(resumeVersions)
    .where(eq(resumeVersions.profileId, pid))
    .orderBy(desc(resumeVersions.createdAt));
}

/** Mark which version of a theme is the one to use for applications. */
export async function setActiveVersion(userId: string, themeId: string, versionId: string) {
  const pid = await profileIdFor(userId);
  await db
    .update(resumeThemes)
    .set({ activeVersionId: versionId })
    .where(and(eq(resumeThemes.id, themeId), eq(resumeThemes.profileId, pid)));
  return { ok: true as const };
}

/**
 * Load a saved version back into the live résumé — a destructive replace of the
 * Layer 2 rows + profile style, inside one transaction. The snapshot is
 * immutable, so this is reversible by restoring another version.
 */
export async function restoreVersion(userId: string, versionId: string) {
  const pid = await profileIdFor(userId);
  const [v] = await db
    .select({ content: resumeVersions.content })
    .from(resumeVersions)
    .where(and(eq(resumeVersions.id, versionId), eq(resumeVersions.profileId, pid)))
    .limit(1);
  if (!v) throw new Error("Version not found");

  // the snapshot is a getFullProfile() shape
  const c = v.content as {
    profile?: Record<string, unknown>;
    experiences?: Record<string, unknown>[];
    education?: Record<string, unknown>[];
    skills?: Record<string, unknown>[];
    projects?: Record<string, unknown>[];
  };

  await db.transaction(async (tx) => {
    if (c.profile) {
      const p = c.profile;
      await tx
        .update(profiles)
        .set({
          fullName: (p.fullName as string) ?? null,
          headline: (p.headline as string) ?? null,
          email: (p.email as string) ?? null,
          phone: (p.phone as string) ?? null,
          location: (p.location as string) ?? null,
          links: (p.links as { label: string; url: string }[]) ?? [],
          styleConfig: (p.styleConfig as Record<string, string | number>) ?? {},
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, pid));
    }

    // replace children wholesale (new ids, positions preserved)
    await tx.delete(experiences).where(eq(experiences.profileId, pid));
    await tx.delete(education).where(eq(education.profileId, pid));
    await tx.delete(skills).where(eq(skills.profileId, pid));
    await tx.delete(projects).where(eq(projects.profileId, pid));

    if (c.experiences?.length) {
      await tx.insert(experiences).values(
        c.experiences.map((e, i) => ({
          profileId: pid,
          org: (e.org as string) ?? null,
          title: (e.title as string) ?? null,
          employmentType: (e.employmentType as string) ?? null,
          location: (e.location as string) ?? null,
          startDate: (e.startDate as string) ?? null,
          endDate: (e.endDate as string) ?? null,
          isCurrent: (e.isCurrent as boolean) ?? false,
          position: (e.position as number) ?? i,
          bullets: (e.bullets as { text: string }[]) ?? [],
        })),
      );
    }
    if (c.education?.length) {
      await tx.insert(education).values(
        c.education.map((e, i) => ({
          profileId: pid,
          institution: (e.institution as string) ?? null,
          degree: (e.degree as string) ?? null,
          field: (e.field as string) ?? null,
          startDate: (e.startDate as string) ?? null,
          endDate: (e.endDate as string) ?? null,
          details: (e.details as string) ?? null,
          position: (e.position as number) ?? i,
        })),
      );
    }
    if (c.skills?.length) {
      await tx.insert(skills).values(
        c.skills.map((sk, i) => ({
          profileId: pid,
          name: (sk.name as string) ?? "skill",
          category: (sk.category as string) ?? null,
          position: (sk.position as number) ?? i,
        })),
      );
    }
    if (c.projects?.length) {
      await tx.insert(projects).values(
        c.projects.map((pr, i) => ({
          profileId: pid,
          name: (pr.name as string) ?? null,
          description: (pr.description as string) ?? null,
          position: (pr.position as number) ?? i,
          bullets: (pr.bullets as { text: string }[]) ?? [],
        })),
      );
    }

    await tx.insert(sources).values({
      profileId: pid,
      kind: "user_edit",
      metadata: { action: "restore_version", versionId },
    });
  });

  return { ok: true as const };
}

/** Themes with their versions nested — the dashboard's main read. */
export async function getThemesWithVersions(userId: string) {
  const [themes, versions] = await Promise.all([listThemes(userId), listVersions(userId)]);
  const byTheme = new Map<string, typeof versions>();
  const untagged: typeof versions = [];
  for (const v of versions) {
    if (v.themeId) {
      const arr = byTheme.get(v.themeId) ?? [];
      arr.push(v);
      byTheme.set(v.themeId, arr);
    } else {
      untagged.push(v);
    }
  }
  return {
    themes: themes.map((t) => ({ ...t, versions: byTheme.get(t.id) ?? [] })),
    untagged,
  };
}

// ---- applications + outcome events ----
export async function createApplication(
  userId: string,
  input: { company?: string; role?: string; resumeVersionId?: string; opportunityId?: string },
) {
  const pid = await profileIdFor(userId);
  const [app] = await db
    .insert(applications)
    .values({
      profileId: pid,
      company: input.company ?? null,
      role: input.role ?? null,
      resumeVersionId: input.resumeVersionId ?? null,
      opportunityId: input.opportunityId ?? null,
      status: "applied",
    })
    .returning({ id: applications.id });
  await db.insert(applicationEvents).values({ applicationId: app.id, stage: "applied", source: "manual" });
  return app;
}

export async function listApplications(userId: string) {
  const pid = await profileIdFor(userId);
  return db
    .select({
      id: applications.id,
      company: applications.company,
      role: applications.role,
      status: applications.status,
      appliedAt: applications.appliedAt,
      resumeVersionId: applications.resumeVersionId,
      themeName: resumeThemes.name,
    })
    .from(applications)
    .leftJoin(resumeVersions, eq(applications.resumeVersionId, resumeVersions.id))
    .leftJoin(resumeThemes, eq(resumeVersions.themeId, resumeThemes.id))
    .where(eq(applications.profileId, pid))
    .orderBy(desc(applications.appliedAt));
}

/** Advance an application to a new stage, recording the funnel event. */
export async function setApplicationStatus(
  userId: string,
  applicationId: string,
  stage: string,
  result?: string,
) {
  const pid = await profileIdFor(userId);
  // ownership check
  const [app] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.profileId, pid)))
    .limit(1);
  if (!app) throw new Error("Application not found");
  await db.update(applications).set({ status: stage }).where(eq(applications.id, applicationId));
  await db.insert(applicationEvents).values({ applicationId, stage, result: result ?? null, source: "manual" });
  return { ok: true as const };
}
