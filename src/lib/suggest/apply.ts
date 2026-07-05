/**
 * Apply an accepted résumé suggestion. Bullets append to a resolved experience
 * or project (stored as `<p>…</p>` to match the TipTap editor's format); skills
 * insert a new skill row. Server-side so the client needn't hold résumé state.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles, experiences, projects, skills, sources } from "@/db/schema";

async function profileIdFor(userId: string): Promise<string> {
  const [p] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) throw new Error("Profile not found");
  return p.id;
}

export type ApplyInput = {
  kind: "bullet" | "skill";
  entryKind?: "experience" | "project";
  entryId?: string;
  text: string;
};

export async function applySuggestion(userId: string, s: ApplyInput) {
  const pid = await profileIdFor(userId);

  if (s.kind === "skill") {
    await db.insert(skills).values({ profileId: pid, name: s.text });
  } else {
    if (!s.entryId || !s.entryKind) throw new Error("No target entry for this bullet");
    const table = s.entryKind === "project" ? projects : experiences;
    const [row] = await db
      .select({ bullets: table.bullets })
      .from(table)
      .where(and(eq(table.id, s.entryId), eq(table.profileId, pid)))
      .limit(1);
    if (!row) throw new Error("Entry not found");
    const bullets = [...((row.bullets as { text: string }[]) ?? []), { text: `<p>${s.text}</p>` }];
    await db.update(table).set({ bullets }).where(eq(table.id, s.entryId));
  }

  await db.insert(sources).values({
    profileId: pid,
    kind: "user_edit",
    metadata: { action: "accept_suggestion", kind: s.kind, entryId: s.entryId ?? null },
  });
  return { ok: true as const };
}
