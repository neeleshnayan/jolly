/**
 * Cloudflare Workers AI provider — hosts Llama, Gemma, DeepSeek-R1 distills, and
 * llama-3.2-vision behind an OpenAI-compatible endpoint. This is drizzle's PROD
 * inference for the per-user path (résumé vision parse, mentor, per-user calls);
 * local Ollama stays for jobs ingestion (see the compute-split decision).
 *
 * Inert until CF_ACCOUNT_ID + CF_API_TOKEN are set AND a task is routed here
 * (LLM_PROVIDER_VECTORIZE=cloudflare, LLM_PROVIDER_MENTOR=cloudflare, …). Model
 * ids use the @cf/… form, e.g.:
 *   @cf/deepseek-ai/deepseek-r1-distill-qwen-32b   (extraction)
 *   @cf/meta/llama-3.2-11b-vision-instruct         (résumé vision parse)
 *   @cf/google/gemma-3-12b-it                       (gemma on CF)
 *
 * API shape mirrors OpenAI (same as the OpenRouter provider). Structured output
 * uses response_format:json_schema with a loose-parse fallback, since CF's schema
 * adherence varies by model. VERIFY request/response shapes against the live
 * endpoint once keys land — CF's OpenAI-compat surface is newer than OpenRouter's.
 */
import type { LLMProvider } from "./types";

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const MODEL = process.env.CF_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";
const LIVE_MODEL = process.env.CF_LIVE_MODEL ?? MODEL;

function base(): string {
  if (!ACCOUNT) throw new Error("CF_ACCOUNT_ID is not set");
  return process.env.CF_BASE_URL ?? `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1`;
}

function headers(): Record<string, string> {
  const key = process.env.CF_API_TOKEN;
  if (!key) throw new Error("CF_API_TOKEN is not set");
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

function parseJsonLoose(s: unknown): unknown {
  if (s && typeof s === "object") return s; // some CF models return already-parsed content
  if (typeof s !== "string") throw new Error(`Cloudflare returned non-text content (${typeof s})`);
  // reasoning models (deepseek-r1) emit <think>…</think> inline — strip before parsing
  const cleaned = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Cloudflare returned unparseable JSON");
  }
}

export const cloudflareProvider: LLMProvider = {
  name: "cloudflare",

  async extractStructured(req) {
    // CF's OpenAI-compat response_format:json_schema is unreliable (it echoes the
    // schema back), so we constrain via the PROMPT instead and salvage the JSON.
    const schemaHint = `\n\nRespond with ONLY a single JSON object matching this JSON Schema — no prose, no markdown fences, no <think>:\n${JSON.stringify(req.jsonSchema)}`;
    const promptWithSchema = `${req.prompt}${schemaHint}`;
    // multimodal: OpenAI-style image_url parts (base64 data URLs) — the vision path
    const userContent = req.images?.length
      ? [
          ...req.images.map((img) => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mediaType || "image/png"};base64,${img.dataBase64}` },
          })),
          { type: "text" as const, text: promptWithSchema },
        ]
      : promptWithSchema;

    const model = req.model ?? MODEL;
    const res = await fetch(`${base()}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 4096,
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Cloudflare returned no content");
    return {
      data: parseJsonLoose(content),
      usage: { model, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
    };
  },

  async *streamChat(req) {
    const systemContent = req.systemCore
      ? [req.systemCore, req.system].filter(Boolean).join("\n\n")
      : req.system;
    const messages = [
      ...(systemContent ? [{ role: "system", content: systemContent }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const model = req.model ?? LIVE_MODEL;
    const res = await fetch(`${base()}/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model, max_tokens: req.maxTokens ?? 1024, messages, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Cloudflare chat ${res.status}`);

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
        if (payload === "[DONE]") {
          req.onUsage?.({ model });
          return;
        }
        try {
          const ev = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = ev.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore keepalive/comment lines */
        }
      }
    }
  },
};
