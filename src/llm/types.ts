/**
 * LLM provider abstraction. Two operations:
 *  - extractStructured: constrain to a JSON schema, return the object (one-shot)
 *  - streamChat: free-form conversational turn, streamed token-by-token
 * Swap providers with LLM_PROVIDER; nothing else changes.
 */

export interface ImagePart {
  mediaType: string; // e.g. "image/png"
  dataBase64: string; // base64, no data: prefix
}

export interface StructuredRequest {
  prompt: string;
  system?: string;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
  /** page images for multimodal extraction — used if the provider supports it */
  images?: ImagePart[];
  /** override how long the model stays resident after this call (Ollama) */
  keepAlive?: string | number;
  /** override which model runs this call (e.g. a faster one for interactive edits) */
  model?: string;
  /** force thinking on/off for models that support it (Ollama). Interactive
   *  extractions on think-capable models (gemma4/qwen3) want false — hidden
   *  reasoning turns a sub-second call into a 15s stall. */
  think?: boolean;
  /** override the context window (Ollama num_ctx) for THIS call. Job vectorisation
   *  needs a big window (long JDs); the voice/live path wants a small one. */
  numCtx?: number;
}

export interface Usage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** real $ from the provider (OpenRouter usage.cost); undefined = estimate downstream */
  costUsd?: number;
}

export interface StructuredResponse {
  data: unknown;
  usage: Usage;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** the STATIC, per-call system prefix — identical across every turn of a call.
   *  Cloud providers cache it (cache_control breakpoint → ~10% input price);
   *  Ollama reuses its KV prefix so prompt-eval skips it. Keep it byte-stable. */
  systemCore?: string;
  /** the per-turn dynamic tail (time left, steering, role dossier). Appended
   *  after the core; never cached. */
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  model?: string;
  /** streaming has no return value, so usage (tokens + real cost) is delivered
   *  here when the final chunk arrives — callers log spend from it */
  onUsage?: (u: Usage) => void;
}

export interface LLMProvider {
  name: string;
  extractStructured(req: StructuredRequest): Promise<StructuredResponse>;
  /** yields text deltas as the model generates */
  streamChat(req: ChatRequest): AsyncIterable<string>;
  /** optional: preload the extraction model into memory (fire-and-forget) */
  warm?(): Promise<void>;
}
