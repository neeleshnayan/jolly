/**
 * Agent — the mentor→résumé feedback loop. Reads the call transcript + the
 * current résumé and proposes concrete additions the person REVEALED on the call
 * but that aren't on their résumé yet. It only proposes; the user one-taps to
 * accept. Hard rule: never invent — only surface what they actually said.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { resumeSuggestions, type ResumeSuggestion } from "@/lib/suggest/schema";

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(resumeSuggestions, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function prompt(transcript: string, resumeText: string): string {
  return `You are helping someone improve their résumé using what they revealed in a mentor CALL. Find concrete, résumé-worthy facts they said on the call that are NOT already on their résumé — quantified wins, real scope/impact, tools or skills they clearly have, achievements they undersold.

For each, return:
- kind: "bullet" (an achievement for a specific role/project) or "skill" (a tool/skill to add).
- targetRole: for a bullet, the role or project it belongs to, named exactly as it appears on their résumé (e.g. "Foodlabs" or "Krypton Fund"). For a skill, "".
- text: for a bullet, one crisp résumé-voice line (strong past-tense verb, concrete, quantified if they gave a number). For a skill, just the skill name.
- rationale: one short phrase on what they said that supports it.
- evidence: a VERBATIM quote (copy the exact words) of the CANDIDATE's line from the
  transcript that proves this. Copy-paste it, do not paraphrase. Suggestions
  whose evidence isn't an actual quote get automatically discarded.

RULES — the only source of truth is what the CANDIDATE SAID in the transcript below:
- The candidate's lines start with "You:". Only those lines count as revealed facts.
  The résumé is context to know what's ALREADY listed — it is NOT a source of suggestions.
- If you cannot copy an exact supporting quote from a "You:" line, DO NOT suggest it.
- Never invent metrics, tools, names, or scope. Never write placeholders like
  "[timeframe]" or "[X%]" — if a detail wasn't said, leave it out of the text entirely.
- Skip anything already present on the résumé below.
- Prefer 2–5 high-signal suggestions. If they revealed nothing new, return an empty list —
  an empty list is a GOOD answer, not a failure.

CALL TRANSCRIPT:
${transcript}

CURRENT RÉSUMÉ (for dedup only — NOT a source):
${resumeText}`;
}

export const resumeSuggester: Agent<
  { transcript: string; resumeText: string },
  { suggestions: ResumeSuggestion[] }
> = {
  name: "resume-suggester",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: "resume_suggestions",
      jsonSchema: jsonSchema(),
      prompt: prompt(input.transcript, input.resumeText),
      maxTokens: 900,
    });
    return { output: resumeSuggestions.parse(res.data), usage: res.usage };
  },
};
