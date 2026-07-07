import { z } from "zod";

// A résumé-worthy fact the mentor surfaced on the call that ISN'T already on the
// résumé. `targetRole` names the role/project a bullet belongs to (empty for a
// skill); the API resolves it to a concrete entry id.
export const resumeSuggestion = z.object({
  kind: z.enum(["bullet", "skill"]),
  targetRole: z.string(),
  text: z.string(),
  rationale: z.string(),
  // VERBATIM quote of the candidate's own words from the transcript that back
  // this suggestion. The server verifies it against the transcript and silently
  // drops suggestions whose evidence doesn't check out — this is the hallucination
  // gate, since a local model can't be trusted to self-police "only what they said".
  evidence: z.string().default(""),
});

export const resumeSuggestions = z.object({
  suggestions: z.array(resumeSuggestion),
});

export type ResumeSuggestion = z.infer<typeof resumeSuggestion>;
