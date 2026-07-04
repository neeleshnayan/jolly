/**
 * Agent — reads a résumé and writes the sharp clarifying questions a mentor
 * should ask on the call: the threads the résumé RAISES but never answers.
 * Runs on the big model (it's already warm from the facts extraction), then the
 * model unloads. Pure; persistence happens in the caller.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { probeExtraction, type ProbeExtraction } from "@/lib/probes/schema";

const SCHEMA_NAME = "record_probes";

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(probeExtraction, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}

const PROMPT = `You are prepping a career mentor for a live call. Read this résumé and write 4–6 sharp clarifying questions — the things the résumé IMPLIES but never answers, that a great mentor would probe.

Look for:
- gaps, pivots, demotions, or job-hopping (what actually happened, and why?)
- unstated ambition, or its absence (do they want to lead? switch domains? go bigger — or are they content?)
- contradictions or recurring patterns across roles
- what's conspicuously missing for someone at their level

Rules:
- NEVER ask what the résumé already states plainly.
- Phrase each question the way a warm, direct mentor would actually say it out loud.
- rationale: one line naming the thread it targets.
- dimension: which part of their map it aims to fill (aspiration / energizer / drainer / value / constraint / goal / pattern / blocker), or null if none fits.

Résumé:
---
`;

export const probeGenerator: Agent<{ rawText: string }, ProbeExtraction> = {
  name: "probe-generator",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: SCHEMA_NAME,
      jsonSchema: jsonSchema(),
      prompt: PROMPT + input.rawText,
      maxTokens: 1200,
    });
    return { output: probeExtraction.parse(res.data), usage: res.usage };
  },
};
