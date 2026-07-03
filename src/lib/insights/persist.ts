/**
 * Write extracted insights onto the map (Layer 3), stamped with a mentor_call
 * source. Same invariant as everywhere: create the immutable source first.
 */
import { db } from "@/db";
import { sources, insights as insightsTable } from "@/db/schema";
import { ensureProfile } from "@/lib/profile/ensure";
import type { InsightExtraction } from "./schema";

export async function persistInsights(opts: {
  userId: string;
  extraction: InsightExtraction;
  transcript: string;
}) {
  const { userId, extraction, transcript } = opts;
  const profileId = await ensureProfile(userId);

  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({ profileId, kind: "mentor_call", rawText: transcript })
      .returning();

    if (extraction.insights.length) {
      await tx.insert(insightsTable).values(
        extraction.insights.map((i) => ({
          profileId,
          dimension: i.dimension,
          content: i.content,
          confidence: i.confidence,
          status: "active" as const,
          sourceId: source.id,
        })),
      );
    }

    return { count: extraction.insights.length, sourceId: source.id };
  });
}
