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

RULES:
- Only include things they ACTUALLY said on the call. Never invent metrics, tools, or scope.
- Skip anything already present on the résumé below.
- Prefer 3–6 high-signal suggestions. If nothing new is worth adding, return an empty list.

CALL TRANSCRIPT:
${transcript}

CURRENT RÉSUMÉ:
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
