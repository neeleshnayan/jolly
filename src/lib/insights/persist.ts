/**
 * Write extracted insights onto the map (Layer 3), stamped with a mentor_call
 * source. Same invariant as everywhere: create the immutable source first.
 */
import { and, eq } from "drizzle-orm";
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

    // valid supersede/reinforce targets = this profile's currently-active insights
    const active = await tx
      .select({ id: insightsTable.id, confidence: insightsTable.confidence })
      .from(insightsTable)
      .where(and(eq(insightsTable.profileId, profileId), eq(insightsTable.status, "active")));
    const activeConf = new Map(active.map((r) => [r.id, r.confidence ?? 0.5]));

    let inserted = 0;
    let reinforced = 0;
    let superseded = 0;

    for (const i of extraction.insights) {
      const stance = i.stance ?? "conviction";
      const target = i.targetId && activeConf.has(i.targetId) ? i.targetId : null;

      // reinforces: corroboration — nudge confidence up + mark freshly confirmed,
      // no duplicate row (this is the dedup path).
      if (i.mode === "reinforces" && target) {
        const bumped = Math.min(1, Math.max(activeConf.get(target)!, i.confidence) + 0.1);
        await tx
          .update(insightsTable)
          .set({ confidence: bumped, lastConfirmedAt: new Date() })
          .where(eq(insightsTable.id, target));
        activeConf.set(target, bumped);
        reinforced++;
        continue;
      }

      // refines/contradicts: the view evolved — retire the old, insert the new
      // that supersedes it (the superseded row stays for the trajectory view).
      const supersedes = (i.mode === "refines" || i.mode === "contradicts") && target ? target : null;
      if (supersedes) {
        await tx.update(insightsTable).set({ status: "superseded" }).where(eq(insightsTable.id, supersedes));
        activeConf.delete(supersedes);
        superseded++;
      }

      await tx.insert(insightsTable).values({
        profileId,
        dimension: i.dimension,
        content: i.content,
        confidence: i.confidence,
        status: "active",
        sourceId: source.id,
        supersedesId: supersedes,
        data: { stance },
      });
      inserted++;
    }

    return { count: inserted, reinforced, superseded, sourceId: source.id };
  });
}
