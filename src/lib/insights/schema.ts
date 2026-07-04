import { z } from "zod";

/**
 * A 0–1 confidence that tolerates a model ignoring the scale. Clamps into range
 * (and rescales an obvious 0–100 answer) instead of rejecting the whole payload.
 */
export const confidence01 = z
  .number()
  .transform((v) => {
    const n = v > 1 ? (v <= 10 ? v / 10 : v / 100) : v; // 8 → 0.8, 85 → 0.85
    return Math.min(1, Math.max(0, n));
  })
  .catch(0.6);

export const insightDimensionEnum = z.enum([
  "aspiration",
  "energizer",
  "drainer",
  "value",
  "constraint",
  "goal",
  "pattern",
  "blocker",
]);

export const extractedInsight = z.object({
  dimension: insightDimensionEnum,
  content: z.string(),
  confidence: confidence01.default(0.6),
});

export const insightExtraction = z.object({
  insights: z.array(extractedInsight).default([]),
});

export type InsightExtraction = z.infer<typeof insightExtraction>;
