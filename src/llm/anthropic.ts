import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./types";

// Lazy: only constructed (and only needs ANTHROPIC_API_KEY) if this provider is
// actually selected — so an Ollama-only setup never touches it.
let _client: Anthropic | null = null;
function client(): Anthropic {
  return (_client ??= new Anthropic());
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export const anthropicProvider: LLMProvider = {
  name: "anthropic",
  async extractStructured(req) {
    const msg = await client().messages.create({
      model: MODEL,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      tools: [
        {
          name: req.schemaName,
          description: "Return the structured result.",
          input_schema: req.jsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: req.schemaName },
      messages: [{ role: "user", content: req.prompt }],
    });

    const block = msg.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("Anthropic returned no structured output");
    }
    return {
      data: block.input,
      usage: {
        model: MODEL,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      },
    };
  },
};
