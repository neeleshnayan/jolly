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
- Each insight: a dimension, a concise first-person-neutral statement, and a confidence from 0.0 to 1.0 (how strongly the conversation supports it — 1.0 = they said it outright, lower = inferred).

DIMENSIONS — pick by the definition, not vibes (energizer and drainer are OPPOSITES; a past extraction filed "derives satisfaction from X" under drainer — that is an energizer):
- energizer: what gives them energy / lights them up / they'd do for free
- drainer: what DEPLETES them / they avoid / would make them quit
- value: what actually matters to them (autonomy, money, security, impact…)
- aspiration: who or what they want to BECOME
- goal: a concrete near-term objective they named
- constraint: a hard limit on their choices (visa, money, family, location)
- pattern: a recurring theme across their history
- blocker: something in the way (skill gap, confidence, network)

STANCE — tag every insight:
- "conviction": who they genuinely ARE or want. A settled trait, value, or real goal.
- "exploration": a path/role/idea they're merely SAMPLING or curious about this call. If they say "I'm wondering about marketing" or ask what X is like, that is exploration — NOT a settled trait. Never let a sampled curiosity read as conviction.

RECONCILE against WHAT WE ALREADY KNOW (below). For each insight set mode + targetId:
- "new": genuinely new, not already covered → no targetId.
- "reinforces": restates/confirms an existing one → targetId = its [id].
- "refines": sharpens or updates an existing one → targetId = its [id].
- "contradicts": conflicts with / replaces an existing one (they changed or grew) → targetId = its [id].
Only use a targetId that appears in the list. If nothing matches, use "new".`;

export const insightExtractor: Agent<
  { transcript: string; currentInsights?: { id: string; dimension: string; content: string }[] },
  InsightExtraction
> = {
  name: "insight-extractor",
  async run(input) {
    const provider = getProvider("mentor");
    const current = input.currentInsights ?? [];
    const knownBlock = current.length
      ? `\n\nWHAT WE ALREADY KNOW (reconcile against these):\n${current
          .map((c) => `[${c.id}] (${c.dimension}) ${c.content}`)
          .join("\n")}`
      : "";
    const res = await provider.extractStructured({
      schemaName: SCHEMA_NAME,
      jsonSchema: jsonSchema(),
      prompt: `${PROMPT}${knownBlock}\n\nConversation:\n---\n${input.transcript}`,
      maxTokens: 2000,
    });
    return { output: insightExtraction.parse(res.data), usage: res.usage };
  },
};
