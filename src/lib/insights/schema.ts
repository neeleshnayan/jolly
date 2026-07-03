import { z } from "zod";

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
  confidence: z.number().min(0).max(1).default(0.6),
});

export const insightExtraction = z.object({
  insights: z.array(extractedInsight).default([]),
});

export type InsightExtraction = z.infer<typeof insightExtraction>;
