/**
 * OpenRouter provider — one key, hundreds of hosted models (Claude, GPT, etc.)
 * via an OpenAI-compatible API. Wired but inert until you set OPENROUTER_API_KEY
 * and select it (LLM_PROVIDER=openrouter, or route a specific task here later).
 * Structured output uses function-calling; chat uses SSE streaming.
 */
import type { LLMProvider } from "./types";

const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
const LIVE_MODEL = process.env.OPENROUTER_LIVE_MODEL ?? MODEL;

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    // optional attribution headers OpenRouter recommends
    "http-referer": process.env.OPENROUTER_APP_URL ?? "http://localhost:3000",
    "x-title": "drizzle",
  };
}

function parseJsonLoose(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("OpenRouter returned unparseable JSON");
  }
}

export const openrouterProvider: LLMProvider = {
  name: "openrouter",

  async extractStructured(req) {
    const userContent = req.images?.length
      ? [
          ...req.images.map((img) => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mediaType || "image/png"};base64,${img.dataBase64}` },
          })),
          { type: "text" as const, text: req.prompt },
        ]
      : req.prompt;

    const model = req.model ?? MODEL;
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 4096,
        usage: { include: true }, // ask OpenRouter to return the real $ cost
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: userContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: req.schemaName,
              description: "Return the structured result.",
              parameters: req.jsonSchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: req.schemaName } },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[]; content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? json.choices?.[0]?.message?.content;
    if (!args) throw new Error("OpenRouter returned no structured output");
    return {
      data: parseJsonLoose(args),
      usage: {
        model,
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        costUsd: json.usage?.cost,
      },
    };
  },

  async *streamChat(req) {
    // cache the static core: a cache_control breakpoint on the core block tells
    // OpenRouter/Anthropic to cache everything up to it (~10% input price on
    // cached reads); the delta block after it stays fresh. Falls back to a plain
    // string system when there's no core (non-mentor callers).
    const systemContent = req.systemCore
      ? [
          { type: "text", text: req.systemCore, cache_control: { type: "ephemeral" } },
          ...(req.system ? [{ type: "text", text: req.system }] : []),
        ]
      : req.system;
    const messages = [
      ...(systemContent ? [{ role: "system", content: systemContent }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const model = req.model ?? LIVE_MODEL;
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(),
      // include_usage → a final chunk carries token counts + real $ cost
      body: JSON.stringify({ model, max_tokens: req.maxTokens ?? 1024, messages, stream: true, stream_options: { include_usage: true } }),
    });
    if (!res.ok || !res.body) throw new Error(`OpenRouter chat ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const ev = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
          };
          const delta = ev.choices?.[0]?.delta?.content;
          if (delta) yield delta;
          // the usage chunk (no choices) arrives last — hand spend to the caller
          if (ev.usage) req.onUsage?.({ model, inputTokens: ev.usage.prompt_tokens, outputTokens: ev.usage.completion_tokens, costUsd: ev.usage.cost });
        } catch {
          /* ignore keepalive/comment lines */
        }
      }
    }
  },
};
