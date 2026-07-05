/**
 * Agent — the "point-and-ask" refiner. Takes a set of résumé bullets + a
 * natural-language instruction and returns a rewritten set. Runs on the fast
 * live model so the edit feels responsive. It PROPOSES; the user accepts.
 * Hard rule: never invent — only rephrase what's there.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { refineResult, type RefineResult } from "@/lib/refine/schema";

const LIVE_MODEL = process.env.OLLAMA_LIVE_MODEL;

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(refineResult, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function prompt(instruction: string, role: string | undefined, bullets: string[]): string {
  return `You are refining a candidate's résumé bullet points. Apply this instruction exactly:
"${instruction}"
${role ? `\nTune them toward this target role:\n${role}\n` : ""}
Rules:
- Keep every claim TRUTHFUL — never invent metrics, tools, scope, or achievements that aren't in the originals.
- Résumé voice: strong past-tense verbs, concrete, concise; quantify only what's already stated or clearly implied.
- Return the same achievements rewritten — don't drop or merge them unless the instruction says so.
- Plain text only: no markdown, no leading "-" or "•".

Current bullets:
${bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")}`;
}

export const bulletRefiner: Agent<
  { instruction: string; bullets: string[]; role?: string },
  RefineResult
> = {
  name: "bullet-refiner",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: "refined_bullets",
      jsonSchema: jsonSchema(),
      prompt: prompt(input.instruction, input.role, input.bullets),
      model: LIVE_MODEL, // fast, interactive
      maxTokens: 900,
    });
    return { output: refineResult.parse(res.data), usage: res.usage };
  },
};
