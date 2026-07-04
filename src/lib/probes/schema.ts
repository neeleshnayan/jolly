import { z } from "zod";
import { insightDimensionEnum } from "@/lib/insights/schema";

/**
 * A probe = a clarifying question the résumé raises but doesn't answer, aimed at
 * a map dimension. Generated at upload, handed to the mentor as call steering.
 */
export const probe = z.object({
  question: z.string(),
  rationale: z.string(),
  dimension: insightDimensionEnum.nullable().default(null),
});

export const probeExtraction = z.object({
  probes: z.array(probe).default([]),
});

export type Probe = z.infer<typeof probe>;
export type ProbeExtraction = z.infer<typeof probeExtraction>;
