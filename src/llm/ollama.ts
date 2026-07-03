import type { LLMProvider } from "./types";

// Uses Ollama's native structured-outputs API: pass a JSON schema as `format`
// and generation is constrained to it. Requires Ollama >= 0.5 and a model that
// handles JSON well (qwen2.5 / llama3.1 are solid). No SDK needed — just fetch.
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export const ollamaProvider: LLMProvider = {
  name: "ollama",
  async extractStructured(req) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: req.jsonSchema, // structured outputs: constrain to the schema
        options: { temperature: 0, num_ctx: 8192 },
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: req.prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as OllamaChatResponse;
    const content = json.message?.content ?? "";
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error(
        `Ollama did not return valid JSON: ${content.slice(0, 200)}`,
      );
    }

    return {
      data,
      usage: {
        model: MODEL,
        inputTokens: json.prompt_eval_count,
        outputTokens: json.eval_count,
      },
    };
  },
};
