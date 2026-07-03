/**
 * LLM provider abstraction. The one operation the app needs today is
 * "constrain the model to a JSON schema and give me back the object" — both
 * Claude (tool-use) and Ollama (structured outputs) can do this. Swap providers
 * with the LLM_PROVIDER env var; nothing else changes.
 */

export interface StructuredRequest {
  /** the full user prompt (rules + payload) */
  prompt: string;
  system?: string;
  /** JSON schema the output must conform to */
  jsonSchema: Record<string, unknown>;
  /** a name for the schema/tool */
  schemaName: string;
  maxTokens?: number;
}

export interface StructuredResponse {
  /** raw parsed object — the caller validates with zod */
  data: unknown;
  usage: { model: string; inputTokens?: number; outputTokens?: number };
}

export interface LLMProvider {
  name: string;
  extractStructured(req: StructuredRequest): Promise<StructuredResponse>;
}
