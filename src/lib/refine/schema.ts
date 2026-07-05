import { z } from "zod";

// bullets is REQUIRED (no default) — a default makes it optional in the JSON
// schema, which lets the model satisfy the constraint with {} and return nothing.
export const refineResult = z.object({
  bullets: z.array(z.string()).min(1),
});

export type RefineResult = z.infer<typeof refineResult>;
