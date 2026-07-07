/**
 * Agent — the executive read at the top of the diagnosis report. Turns the
 * scoring vector + accumulated insights into a consultant-grade narrative:
 * sharp, specific, evidence-backed — never horoscope-generic. Everything it
 * says must trace to the material it's given (closed world, as always).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";

export const diagnosisResult = z.object({
  // one sentence that would make them say "yes, that's me" — the sharp read
  readline: z.string(),
  // exactly two short paragraphs: (1) who they are at their best, with evidence;
  // (2) the central tension holding them back / to resolve next
  narrative: z.array(z.string()).max(3),
  // three concrete, near-term moves that follow FROM the diagnosis
  moves: z.array(z.string()).max(4),
});
export type DiagnosisResult = z.infer<typeof diagnosisResult>;

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(diagnosisResult, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function prompt(material: string): string {
  return `You are a top-tier career strategist writing the EXECUTIVE READ of a diagnosis report. You've studied this person's work-style scores (each with evidence) and everything their mentor has learned across calls. Write like a McKinsey partner who actually knows them: crisp, confident, zero filler.

- readline: ONE sentence that names who they are professionally and the core dynamic of their situation. Sharp enough that a generic person couldn't wear it.
- narrative: TWO short paragraphs (3-4 sentences each). First: who they are at their best — cite specific evidence from the material (real roles, real signals). Second: the central tension or gap between where their energy points and where they currently are, stated plainly but with respect.
- moves: THREE concrete near-term moves that follow logically from the diagnosis. Specific actions, not platitudes ("talk to 3 founding engineers at seed-stage fintechs" beats "network more").

RULES: Use ONLY the material below — no invented facts, numbers, or events. Copy numbers and currency EXACTLY as written ("1.5L MRR" stays "1.5L MRR" — never convert ₹ lakhs to $, never round). Plain prose only — no markdown, no asterisks, no bold. No flattery-padding, no "journey", no "passionate". If the material is thin, say less rather than inventing.

MATERIAL:
${material}`;
}

export const diagnosisWriter: Agent<{ material: string }, DiagnosisResult> = {
  name: "diagnosis-writer",
  async run(input) {
    const provider = getProvider("diagnosis");
    // local models occasionally emit truncated JSON — one retry clears most flakes
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await provider.extractStructured({
          schemaName: "diagnosis",
          jsonSchema: jsonSchema(),
          prompt: prompt(input.material),
          maxTokens: 1200,
        });
        return { output: diagnosisResult.parse(res.data), usage: res.usage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
