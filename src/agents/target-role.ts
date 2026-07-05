/**
 * Agent — recommends the role the person should aim for, given their résumé +
 * what the mentor learned on the call. Fills the "TBD" target-role theme.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";

export const targetRole = z.object({
  role: z.string(), // concise role title, e.g. "Founding Engineer", "Quant Researcher"
  rationale: z.string(), // one sentence on why it fits
});
export type TargetRole = z.infer<typeof targetRole>;

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(targetRole, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export const targetRoleRecommender: Agent<{ profileText: string }, TargetRole> = {
  name: "target-role-recommender",
  async run(input) {
    const provider = getProvider("mentor");
    const res = await provider.extractStructured({
      schemaName: "target_role",
      jsonSchema: jsonSchema(),
      prompt: `Based on this person's résumé AND what their mentor learned about them on a call, recommend ONE role they should aim for next — the one that best fits who they are and what energizes them, even if it's a stretch from their current title. Give a concise role title and one sentence on why it fits. Don't invent facts.

${input.profileText}`,
      maxTokens: 200,
    });
    return { output: targetRole.parse(res.data), usage: res.usage };
  },
};
