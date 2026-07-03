/**
 * Write an extraction into the spine, transactionally. The one non-negotiable:
 * create the immutable `source` first, then stamp every derived row with its id.
 * That's the evidence trail the mentor will later lean on.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  profiles,
  sources,
  experiences,
  education,
  skills,
  projects,
} from "@/db/schema";
import type { ResumeExtraction } from "@/lib/extraction/schema";

export async function persistExtraction(opts: {
  userId: string;
  extraction: ResumeExtraction;
  rawText: string;
  storagePath: string | null;
}) {
  const { userId, extraction, rawText, storagePath } = opts;

  return db.transaction(async (tx) => {
    // find-or-create the user's profile (Layer 2 root)
    let [profile] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) {
      [profile] = await tx.insert(profiles).values({ userId }).returning();
    }
    const profileId = profile.id;

    // fill profile scalars (keep existing values if the extraction is null)
    const p = extraction.profile;
    await tx
      .update(profiles)
      .set({
        fullName: p.fullName ?? profile.fullName,
        headline: p.headline ?? profile.headline,
        email: p.email ?? profile.email,
        phone: p.phone ?? profile.phone,
        location: p.location ?? profile.location,
        links: p.links.length ? p.links : profile.links,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, profileId));

    // Layer 1: the immutable source (create BEFORE the derived rows)
    const [source] = await tx
      .insert(sources)
      .values({ profileId, kind: "resume_upload", storagePath, rawText })
      .returning();
    const sourceId = source.id;

    // Layer 2: derived facts, each stamped with the source
    if (extraction.experiences.length) {
      await tx.insert(experiences).values(
        extraction.experiences.map((e) => ({
          profileId,
          org: e.org,
          title: e.title,
          employmentType: e.employmentType,
          location: e.location,
          startDate: e.startDate,
          endDate: e.endDate,
          isCurrent: e.isCurrent,
          bullets: e.bullets.map((text) => ({ text, sourceId })),
          sourceId,
          confidence: e.confidence,
        })),
      );
    }

    if (extraction.education.length) {
      await tx.insert(education).values(
        extraction.education.map((e) => ({
          profileId,
          institution: e.institution,
          degree: e.degree,
          field: e.field,
          startDate: e.startDate,
          endDate: e.endDate,
          details: e.details,
          sourceId,
          confidence: e.confidence,
        })),
      );
    }

    if (extraction.skills.length) {
      await tx.insert(skills).values(
        extraction.skills.map((s) => ({
          profileId,
          name: s.name,
          category: s.category,
          sourceId,
          confidence: s.confidence,
        })),
      );
    }

    if (extraction.projects.length) {
      await tx.insert(projects).values(
        extraction.projects.map((pr) => ({
          profileId,
          name: pr.name,
          description: pr.description,
          links: pr.links,
          bullets: pr.bullets.map((text) => ({ text, sourceId })),
          sourceId,
          confidence: pr.confidence,
        })),
      );
    }

    return {
      profileId,
      sourceId,
      counts: {
        experiences: extraction.experiences.length,
        education: extraction.education.length,
        skills: extraction.skills.length,
        projects: extraction.projects.length,
      },
    };
  });
}
