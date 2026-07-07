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
  certifications,
} from "@/db/schema";

const bullet = z.object({ text: z.string(), sourceId: z.string().optional() });

const profilePatch = z
  .object({
    fullName: z.string().nullable(),
    headline: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    styleConfig: z.record(z.string(), z.union([z.string(), z.number()])),
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
    location: z.string().nullable(),
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

const certificationPatch = z
  .object({
    name: z.string().nullable(),
    issuer: z.string().nullable(),
    date: z.string().nullable(),
  })
  .partial()
  .strict();

const projectPatch = z
  .object({
    name: z.string().nullable(),
    description: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
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
  certification: certificationPatch,
} as const;

export type EditKind = keyof typeof patchByKind;
export type EntryKind = "experience" | "education" | "skill" | "project" | "certification";

function requireId(id: string | undefined): asserts id is string {
  if (!id) throw new Error("id is required for this edit");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function profileIdFor(tx: Tx, userId: string): Promise<string> {
  const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) throw new Error("Profile not found");
  return profile.id;
}

/** Add a blank entry to a section; returns its id so the client can edit it. */
export async function createEntry(userId: string, kind: EntryKind) {
  return db.transaction(async (tx) => {
    const pid = await profileIdFor(tx, userId);
    let id: string;
    switch (kind) {
      case "experience": {
        const [r] = await tx.insert(experiences).values({ profileId: pid, bullets: [], isCurrent: false }).returning({ id: experiences.id });
        id = r.id;
        break;
      }
      case "education": {
        const [r] = await tx.insert(education).values({ profileId: pid }).returning({ id: education.id });
        id = r.id;
        break;
      }
      case "skill": {
        const [r] = await tx.insert(skills).values({ profileId: pid, name: "New skill" }).returning({ id: skills.id });
        id = r.id;
        break;
      }
      case "project": {
        const [r] = await tx.insert(projects).values({ profileId: pid, bullets: [] }).returning({ id: projects.id });
        id = r.id;
        break;
      }
      case "certification": {
        const [r] = await tx.insert(certifications).values({ profileId: pid }).returning({ id: certifications.id });
        id = r.id;
        break;
      }
    }
    await tx.insert(sources).values({ profileId: pid, kind: "user_edit", metadata: { action: "create", entity: kind, id } });
    return { id };
  });
}

/** Set the order of a section's entries (position = index in `ids`). */
export async function reorderEntries(userId: string, kind: EntryKind, ids: string[]) {
  return db.transaction(async (tx) => {
    const pid = await profileIdFor(tx, userId);
    const table = { experience: experiences, education, skill: skills, project: projects, certification: certifications }[kind];
    for (let i = 0; i < ids.length; i++) {
      await tx.update(table).set({ position: i }).where(and(eq(table.id, ids[i]), eq(table.profileId, pid)));
    }
    return { ok: true as const };
  });
}

/** Remove an entry. */
export async function deleteEntry(userId: string, kind: EntryKind, id: string) {
  return db.transaction(async (tx) => {
    const pid = await profileIdFor(tx, userId);
    const where = { experience: experiences, education, skill: skills, project: projects, certification: certifications }[kind];
    await tx.delete(where).where(and(eq(where.id, id), eq(where.profileId, pid)));
    await tx.insert(sources).values({ profileId: pid, kind: "user_edit", metadata: { action: "delete", entity: kind, id } });
    return { ok: true as const };
  });
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
    const pid = await profileIdFor(tx, userId);
    await applyOne(tx, pid, kind, id, patch);
    await tx.insert(sources).values({
      profileId: pid,
      kind: "user_edit",
      metadata: { entity: kind, id: id ?? pid, patch },
    });
    return { ok: true as const };
  });
}

/** Apply many edits (from the batched autosave) in one transaction + one source. */
export async function applyEdits(
  userId: string,
  edits: { kind: EditKind; id?: string; patch: unknown }[],
) {
  const parsed = edits.map((e) => ({
    kind: e.kind,
    id: e.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch: patchByKind[e.kind].parse(e.patch) as any,
  }));
  return db.transaction(async (tx) => {
    const pid = await profileIdFor(tx, userId);
    for (const e of parsed) await applyOne(tx, pid, e.kind, e.id, e.patch);
    await tx.insert(sources).values({
      profileId: pid,
      kind: "user_edit",
      metadata: { batch: parsed.map((e) => ({ entity: e.kind, id: e.id ?? pid, patch: e.patch })) },
    });
    return { ok: true as const, count: parsed.length };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyOne(tx: Tx, pid: string, kind: EditKind, id: string | undefined, patch: any) {
  switch (kind) {
    case "profile":
      await tx.update(profiles).set({ ...patch, updatedAt: new Date() }).where(eq(profiles.id, pid));
      break;
    case "experience":
      requireId(id);
      await tx.update(experiences).set({ ...patch, updatedAt: new Date() }).where(and(eq(experiences.id, id), eq(experiences.profileId, pid)));
      break;
    case "education":
      requireId(id);
      await tx.update(education).set({ ...patch, updatedAt: new Date() }).where(and(eq(education.id, id), eq(education.profileId, pid)));
      break;
    case "skill":
      requireId(id);
      await tx.update(skills).set({ ...patch }).where(and(eq(skills.id, id), eq(skills.profileId, pid)));
      break;
    case "project":
      requireId(id);
      await tx.update(projects).set({ ...patch, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.profileId, pid)));
      break;
    case "certification":
      requireId(id);
      await tx.update(certifications).set({ ...patch }).where(and(eq(certifications.id, id), eq(certifications.profileId, pid)));
      break;
  }
}
