/**
 * rawText -> validated structured extraction. Provider-agnostic: the actual
 * model call goes through the LLM provider abstraction (Ollama locally, Claude
 * in prod). The LLM is a pure function here; nothing is persisted in this file.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { resumeExtraction, type ResumeExtraction } from "./schema";
import { getProvider } from "@/llm";

const SCHEMA_NAME = "record_resume";

function buildJsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(resumeExtraction, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema; // providers want a bare object schema
  return js;
}

const PROMPT = `Extract the structured contents of this resume into the schema.
Rules:
- Preserve the person's own wording in bullet points; do not rephrase.
- If a field is unknown, use null (or an empty list). Never invent information.
- confidence reflects how clearly the resume states each item (1 = explicit, lower = inferred).

Resume:
---
`;

export async function extractResume(rawText: string): Promise<{
  data: ResumeExtraction;
  usage: { model: string; inputTokens?: number; outputTokens?: number };
}> {
  const provider = getProvider();
  const res = await provider.extractStructured({
    schemaName: SCHEMA_NAME,
    jsonSchema: buildJsonSchema(),
    prompt: PROMPT + rawText,
    maxTokens: 8000,
  });

  return { data: resumeExtraction.parse(res.data), usage: res.usage };
}
