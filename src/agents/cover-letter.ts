/**
 * Agent — writes a short, honest cover letter from the profile + the mentor's
 * insights, optionally tailored to a pasted job description. Draws ONLY on what
 * the résumé/insights contain — the gate against generic-AI-slop letters is
 * specificity: real projects, real numbers, the candidate's actual throughline.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";

export const coverLetterResult = z.object({
  letter: z.string(),
  // when a JD is supplied: the 2-3 strongest hooks between candidate and role,
  // shown to the user so they see WHY the letter says what it says
  hooks: z.array(z.string()).default([]),
});
export type CoverLetterResult = z.infer<typeof coverLetterResult>;

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(coverLetterResult, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function prompt(profileText: string, jd?: string): string {
  const target = jd?.trim()
    ? `\n\nTARGET JOB (tailor the letter to this — mirror its real requirements with the candidate's real experience; never claim skills the résumé doesn't show):\n${jd.trim()}`
    : "\n\n(No specific job provided — write a strong general letter around their clearest strengths and direction.)";
  return `Write a cover letter for this candidate. 170–240 words, first person.

VOICE & RULES:
- Confident equal, not supplicant: no "I am writing to express my interest", no groveling, no "esteemed company".
- Concrete beats adjectives: lead with the candidate's strongest real work (projects, numbers, outcomes from the résumé below) — the letter should be impossible for another candidate to have written.
- Plain, warm, direct sentences. No corporate filler, no "passionate", no "leverage synergies".
- NEVER invent: no metrics, employers, tools, or claims that aren't in the material below.
- Structure: a sharp opening line about what they build/do → one short paragraph of proof (their best relevant work) → one on why THIS role/company fits their direction → a simple confident close. Sign off with just their name.
- hooks: list the 2-3 strongest candidate↔role connection points you used (short phrases).

CANDIDATE MATERIAL (the complete universe — nothing else exists):
${profileText}${target}`;
}

export const coverLetterWriter: Agent<{ profileText: string; jd?: string }, CoverLetterResult> = {
  name: "cover-letter-writer",
  async run(input) {
    const provider = getProvider("cover_letter");
    // local models occasionally emit truncated JSON — one retry clears most flakes
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await provider.extractStructured({
          schemaName: "cover_letter",
          jsonSchema: jsonSchema(),
          prompt: prompt(input.profileText, input.jd),
          maxTokens: 900,
        });
        return { output: coverLetterResult.parse(res.data), usage: res.usage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
