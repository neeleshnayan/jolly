/**
 * Agent #2 — reads a mentor-call transcript and extracts the soft, inferred
 * understanding (Layer 3 insights). Same pure shape as the résumé extractor;
 * persistence happens in the runner/caller.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { insightExtraction, type InsightExtraction } from "@/lib/insights/schema";

const SCHEMA_NAME = "record_insights";

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(insightExtraction, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema;
  return js;
}

const PROMPT = `Read this career mentoring conversation and extract what it reveals about the person.
Rules:
- Only capture what the conversation actually supports — do not invent.
- Prefer non-obvious insights (patterns, contradictions, real motivations) over restating their résumé.
- Each insight: a dimension, a concise first-person-neutral statement, and a confidence (how strongly the conversation supports it).

Conversation:
---
`;

export const insightExtractor: Agent<{ transcript: string }, InsightExtraction> = {
  name: "insight-extractor",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: SCHEMA_NAME,
      jsonSchema: jsonSchema(),
      prompt: PROMPT + input.transcript,
      maxTokens: 2000,
    });
    return { output: insightExtraction.parse(res.data), usage: res.usage };
  },
};
