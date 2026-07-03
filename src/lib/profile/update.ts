/**
 * A single, whitelisted edit path. Every edit does two things atomically:
 * (1) updates the Layer 2 row, (2) writes an immutable `user_edit` source.
 * That second part is the capture-as-byproduct loop — what the user changes is
 * signal the mentor will read later.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  profiles,
  sources,
  experiences,
  education,
  skills,
  projects,
} from "@/db/schema";

const bullet = z.object({ text: z.string(), sourceId: z.string().optional() });

const profilePatch = z
  .object({
    fullName: z.string().nullable(),
    headline: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
  })
  .partial()
  .strict();

const experiencePatch = z
  .object({
    org: z.string().nullable(),
    title: z.string().nullable(),
    location: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    isCurrent: z.boolean(),
    bullets: z.array(bullet),
  })
  .partial()
  .strict();

const educationPatch = z
  .object({
    institution: z.string().nullable(),
    degree: z.string().nullable(),
    field: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    details: z.string().nullable(),
  })
  .partial()
  .strict();

const skillPatch = z
  .object({ name: z.string(), category: z.string().nullable() })
  .partial()
  .strict();

const projectPatch = z
  .object({
    name: z.string().nullable(),
    description: z.string().nullable(),
    bullets: z.array(bullet),
  })
  .partial()
  .strict();

const patchByKind = {
  profile: profilePatch,
  experience: experiencePatch,
  education: educationPatch,
  skill: skillPatch,
  project: projectPatch,
} as const;

export type EditKind = keyof typeof patchByKind;

function requireId(id: string | undefined): asserts id is string {
  if (!id) throw new Error("id is required for this edit");
}

export async function applyEdit(input: {
  userId: string;
  kind: EditKind;
  id?: string;
  patch: unknown;
}) {
  const { userId, kind, id } = input;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = patchByKind[kind].parse(input.patch) as any;

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) throw new Error("Profile not found");
    const pid = profile.id;

    switch (kind) {
      case "profile":
        await tx
          .update(profiles)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(profiles.id, pid));
        break;
      case "experience":
        requireId(id);
        await tx
          .update(experiences)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(experiences.id, id), eq(experiences.profileId, pid)));
        break;
      case "education":
        requireId(id);
        await tx
          .update(education)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(education.id, id), eq(education.profileId, pid)));
        break;
      case "skill":
        requireId(id);
        await tx
          .update(skills)
          .set({ ...patch })
          .where(and(eq(skills.id, id), eq(skills.profileId, pid)));
        break;
      case "project":
        requireId(id);
        await tx
          .update(projects)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(projects.id, id), eq(projects.profileId, pid)));
        break;
    }

    await tx.insert(sources).values({
      profileId: pid,
      kind: "user_edit",
      metadata: { entity: kind, id: id ?? pid, patch },
    });

    return { ok: true as const };
  });
}
