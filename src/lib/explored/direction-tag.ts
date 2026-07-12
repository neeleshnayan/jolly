/**
 * Mint a THEMATIC direction tag for an explored path. A JD is not a direction —
 * "Senior GTM Engineer, Marketing Operations @ Webflow" is a job; the DIRECTION
 * it represents is a trajectory theme (role family + domain + altitude). We ask
 * the mentor-tier LLM to name that theme so the explored-paths surface reads as
 * "where you're heading", not "a posting you clicked". Timestamped so a user's
 * directions form a dated trail. Falls back to a deterministic distill if the
 * model is unavailable, so a dive never breaks over this.
 */
import { getProvider } from "@/llm";
import { distillDirection } from "@/lib/track/persist";

export type DirectionTag = { directionTag: string; taggedAt: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["direction"],
  properties: {
    direction: {
      type: "string",
      description:
        "A high-level career DIRECTION: role family + domain + altitude (3–6 words). NOT a job title, NOT a company. e.g. 'GTM engineering in AI-native SaaS', 'Design leadership in fintech'.",
    },
  },
} as const;

const SYSTEM =
  "You name a career DIRECTION in plain, punchy language — a recognizable role family + domain. GOOD: 'GTM engineering for SaaS', 'Fintech design leadership', 'ML platform engineering'. BAD: 'Product-focused marketing technology engineering' (stacked abstract adjectives — say 'Marketing-ops engineering'). Rules: 2–5 words, concrete over lofty, no stacked adjectives, never a job title, company, or location.";

export async function mintDirectionTag(input: {
  title: string;
  why?: string | null;
  kind?: string | null;
}): Promise<DirectionTag> {
  const taggedAt = new Date().toISOString();
  const fallback = distillDirection(input.title);
  try {
    const provider = getProvider("mentor");
    const res = await provider.extractStructured({
      schemaName: "direction_tag",
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 60,
      think: false,
      system: SYSTEM,
      prompt:
        `A user explored this path with their mentor. Name the DIRECTION it represents — the trajectory theme, not the job.\n\n` +
        `Role discussed: ${input.title}` +
        (input.kind ? `\nFraming: ${input.kind}` : "") +
        (input.why ? `\nWhy it fits them: ${input.why}` : ""),
    });
    const direction = (res.data as { direction?: string })?.direction?.trim();
    return { directionTag: direction && direction.length >= 2 ? direction : fallback, taggedAt };
  } catch {
    return { directionTag: fallback, taggedAt };
  }
}
