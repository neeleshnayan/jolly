import type { LLMProvider } from "./types";

// Uses Ollama's native structured-outputs API: pass a JSON schema as `format`
// and generation is constrained to it. Requires Ollama >= 0.5 and a model that
// handles JSON well (qwen2.5 / llama3.1 are solid). No SDK needed — just fetch.
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
// Live voice turns want low first-token latency over raw quality, so they can run
// a smaller/faster model than the extraction path. Falls back to MODEL if unset.
const LIVE_MODEL = process.env.OLLAMA_LIVE_MODEL ?? MODEL;

// VRAM policy. Extraction runs the big model (gemma3:27b, ~17GB) — unload it the
// moment doc processing finishes so CUDA is free for the voice stack (whisper +
// TTS + the small live model). The live model stays warm through a call.
const EXTRACT_KEEP_ALIVE = process.env.OLLAMA_EXTRACT_KEEP_ALIVE ?? 0;
const LIVE_KEEP_ALIVE = process.env.OLLAMA_LIVE_KEEP_ALIVE ?? "5m";
// a pre-warm keeps the extraction model resident just long enough for the
// extraction call (fired seconds later) to land on a hot model
const EXTRACT_WARM_KEEP_ALIVE = process.env.OLLAMA_EXTRACT_WARM_KEEP_ALIVE ?? "2m";
const NUM_GPU = process.env.OLLAMA_NUM_GPU;
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 8192);
const NUM_PREDICT = process.env.OLLAMA_NUM_PREDICT
  ? Number(process.env.OLLAMA_NUM_PREDICT)
  : undefined;
const THINK =
  process.env.OLLAMA_THINK === undefined
    ? undefined
    : process.env.OLLAMA_THINK.toLowerCase() !== "false";
// Voice turns must NEVER think: gemma4/qwen3 default to hidden reasoning tokens,
// which reads as a 10-20s dead-air stall before every spoken reply (measured:
// 382 tokens/16s thinking vs 17 tokens/0.7s without). Default hard-off for the
// live path; OLLAMA_LIVE_THINK=true to re-enable for experiments.
const LIVE_THINK = (process.env.OLLAMA_LIVE_THINK ?? "false").toLowerCase() !== "false";

function ollamaOptions(opts: {
  temperature: number;
  numCtx: number;
  numPredict?: number;
}) {
  return {
    temperature: opts.temperature,
    num_ctx: opts.numCtx,
    ...(opts.numPredict ? { num_predict: opts.numPredict } : {}),
    ...(NUM_GPU ? { num_gpu: Number(NUM_GPU) } : {}),
  };
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

// `format` should constrain output to bare JSON, but some models still wrap it in
// ```json fences or emit a stray preamble. Salvage the JSON object/array before
// giving up, so one chatty model doesn't break the whole extraction path.
function parseJsonLoose(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const bare = content.match(/[{[][\s\S]*[}\]]/)?.[0];
    const candidate = (fenced ?? bare)?.trim();
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        /* fall through to the error below */
      }
    }
    throw new Error(
      `Ollama did not return valid JSON: ${content.slice(0, 200)}`,
    );
  }
}

/**
 * Evict the live voice model from VRAM (keep_alive: 0). Call BEFORE loading the
 * big extraction model: qwen (~5GB) + voicebox (~3.5GB) + gemma3:27b (16.5GB)
 * don't fit in 24GB together — post-call insight extraction and job inference
 * were OOMing exactly this way. Best-effort; never throws.
 */
export async function releaseLiveModel(): Promise<void> {
  // when live and extract are the SAME model (the one-small-model doctrine on
  // low-RAM boxes), eviction would just force a pointless 20s reload
  if (LIVE_MODEL === MODEL) return;
  try {
    await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: LIVE_MODEL, keep_alive: 0 }),
    });
  } catch {
    /* ollama down or model not loaded — nothing to release */
  }
}

export const ollamaProvider: LLMProvider = {
  name: "ollama",

  // Preload the extraction model into VRAM. Ollama loads a model on a request
  // with no prompt, so this returns as soon as the model is resident. Fire it as
  // the upload arrives so the load overlaps PDF parsing/rendering.
  async warm() {
    await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, keep_alive: EXTRACT_WARM_KEEP_ALIVE }),
    }).catch(() => {});
  },
  async extractStructured(req) {
    const body = JSON.stringify({
      model: req.model ?? MODEL,
      stream: false,
      keep_alive: req.keepAlive ?? EXTRACT_KEEP_ALIVE, // default: free VRAM after this call
      ...(req.think !== undefined ? { think: req.think } : THINK === undefined ? {} : { think: THINK }),
      format: req.jsonSchema, // structured outputs: constrain to the schema
      options: ollamaOptions({
        temperature: 0,
        numCtx: NUM_CTX,
        numPredict: NUM_PREDICT ?? req.maxTokens,
      }),
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        {
          role: "user",
          content: req.prompt,
          // Ollama takes raw base64 strings; needs a vision model (e.g. gemma3)
          ...(req.images?.length ? { images: req.images.map((i) => i.dataBase64) } : {}),
        },
      ],
    });

    // A 5xx here often means llama-server crashed under memory pressure (e.g. a
    // vision-projector CPU-offload OOM) and Ollama is reloading it. Wait and
    // retry once — the reload usually lands on a clean load.
    let res!: Response;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.ok || res.status < 500 || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as OllamaChatResponse;
    const content = json.message?.content ?? "";
    const data = parseJsonLoose(content);

    return {
      data,
      usage: {
        model: MODEL,
        inputTokens: json.prompt_eval_count,
        outputTokens: json.eval_count,
      },
    };
  },

  async *streamChat(req) {
    // core FIRST so the stable prefix stays byte-identical across turns —
    // llama.cpp reuses its KV cache for it, so prompt-eval skips re-reading
    // the whole persona+profile every turn (the local latency win).
    const system = [req.systemCore, req.system].filter(Boolean).join("\n\n");
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model ?? LIVE_MODEL,
        stream: true,
        keep_alive: LIVE_KEEP_ALIVE, // keep the voice model warm across turns
        think: THINK ?? LIVE_THINK, // default false — see LIVE_THINK note above

        options: ollamaOptions({ temperature: 0.7, numCtx: NUM_CTX }),
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          ...req.messages,
        ],
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama stream error ${res.status}`);
    }

    // Ollama streams NDJSON: one JSON object per line.
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
        if (!line) continue;
        try {
          const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number };
          if (j.message?.content) yield j.message.content;
          if (j.done) {
            // local → $0, but tokens still feed the ROI/usage view
            req.onUsage?.({ model: req.model ?? LIVE_MODEL, inputTokens: j.prompt_eval_count, outputTokens: j.eval_count, costUsd: 0 });
            return;
          }
        } catch {
          /* ignore partial/non-JSON lines */
        }
      }
    }
  },
};
