import { z } from "zod";

// A résumé-worthy fact the mentor surfaced on the call that ISN'T already on the
// résumé. `targetRole` names the role/project a bullet belongs to (empty for a
// skill); the API resolves it to a concrete entry id.
export const resumeSuggestion = z.object({
  kind: z.enum(["bullet", "skill"]),
  targetRole: z.string(),
  text: z.string(),
  rationale: z.string(),
});

export const resumeSuggestions = z.object({
  suggestions: z.array(resumeSuggestion),
});

export type ResumeSuggestion = z.infer<typeof resumeSuggestion>;
