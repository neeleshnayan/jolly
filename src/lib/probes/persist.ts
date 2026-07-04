/**
 * Write generated probes for a profile. Stamped with the résumé source so each
 * probe traces back to the upload that raised it.
 */
import { db } from "@/db";
import { mentorProbes } from "@/db/schema";
import { ensureProfile } from "@/lib/profile/ensure";
import type { ProbeExtraction } from "./schema";

export async function persistProbes(opts: {
  userId: string;
  extraction: ProbeExtraction;
  sourceId?: string | null;
}) {
  const { userId, extraction, sourceId } = opts;
  if (!extraction.probes.length) return { count: 0 };
  const profileId = await ensureProfile(userId);

  await db.insert(mentorProbes).values(
    extraction.probes.map((p) => ({
      profileId,
      question: p.question,
      rationale: p.rationale,
      dimension: p.dimension ?? null,
      status: "open" as const,
      sourceId: sourceId ?? null,
    })),
  );
  return { count: extraction.probes.length };
}
