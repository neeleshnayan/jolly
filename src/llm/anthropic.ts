import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./types";

// Lazy: only constructed (and only needs ANTHROPIC_API_KEY) if this provider is
// actually selected — so an Ollama-only setup never touches it.
let _client: Anthropic | null = null;
function client(): Anthropic {
  return (_client ??= new Anthropic());
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const LIVE_MODEL = process.env.ANTHROPIC_LIVE_MODEL ?? "claude-sonnet-5";

export const anthropicProvider: LLMProvider = {
  name: "anthropic",
  async extractStructured(req) {
    type UserContent = Anthropic.Messages.MessageParam["content"];
    const imageType = "image/png" as const;
    const content: UserContent = req.images?.length
      ? [
          ...req.images.map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (img.mediaType || imageType) as typeof imageType,
              data: img.dataBase64,
            },
          })),
          { type: "text" as const, text: req.prompt },
        ]
      : req.prompt;

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
      messages: [{ role: "user", content }],
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

  async *streamChat(req) {
    // Anthropic keeps system separate and requires messages to start with user.
    // Cache the static core with a cache_control breakpoint; the delta + any
    // inline system messages follow as fresh blocks.
    const tail = [req.system, ...req.messages.filter((m) => m.role === "system").map((m) => m.content)].filter(
      Boolean,
    ) as string[];
    const system: Anthropic.Messages.MessageCreateParams["system"] = req.systemCore
      ? ([
          { type: "text", text: req.systemCore, cache_control: { type: "ephemeral" } },
          ...tail.map((t) => ({ type: "text", text: t })),
        ] as Anthropic.Messages.TextBlockParam[])
      : tail.length
        ? tail.join("\n\n")
        : undefined;

    const msgs = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    while (msgs.length && msgs[0].role === "assistant") msgs.shift();
    if (msgs.length === 0) msgs.push({ role: "user", content: "Hello." });

    const stream = client().messages.stream({
      model: req.model ?? LIVE_MODEL,
      max_tokens: req.maxTokens ?? 1024,
      system,
      messages: msgs,
    });

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield ev.delta.text;
      }
    }
  },
};
