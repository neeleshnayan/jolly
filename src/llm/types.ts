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
}

export interface StructuredResponse {
  data: unknown;
  usage: { model: string; inputTokens?: number; outputTokens?: number };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  model?: string;
}

export interface LLMProvider {
  name: string;
  extractStructured(req: StructuredRequest): Promise<StructuredResponse>;
  /** yields text deltas as the model generates */
  streamChat(req: ChatRequest): AsyncIterable<string>;
}
