/**
 * rawText -> validated structured extraction. Provider-agnostic: the actual
 * model call goes through the LLM provider abstraction (Ollama locally, Claude
 * in prod). The LLM is a pure function here; nothing is persisted in this file.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { resumeExtraction, type ResumeExtraction } from "./schema";
import { getProvider, type ImagePart } from "@/llm";

const SCHEMA_NAME = "record_resume";

function buildJsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(resumeExtraction, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete js.$schema; // providers want a bare object schema
  return js;
}

const RULES = `Rules:
- Capture EVERY experience, project, and education entry — never merge or skip any.
- Attribute each bullet to the entry it visually belongs under.
- Preserve the person's own wording and all numbers/metrics EXACTLY; do not rephrase or round.
- Header lines often carry metadata: "Company | tagline   Location", then "Role   Dates". Parse org, title, location, and dates from there.
- If a field is unknown, use null (or an empty list). Never invent.
- confidence: 1 = explicit, lower = inferred.`;

const IMAGE_PROMPT = `These images are the pages of a résumé. Read the visual layout and extract its structured contents into the schema.
${RULES}`;

const TEXT_PROMPT = `Extract the structured contents of this résumé into the schema. The text was reconstructed from a PDF in reading order — each entry starts at its header line and owns the bullets that follow until the next header.
${RULES}

Résumé:
---
`;

export async function extractResume(input: {
  rawText?: string;
  images?: ImagePart[];
}): Promise<{
  data: ResumeExtraction;
  usage: { model: string; inputTokens?: number; outputTokens?: number };
}> {
  const provider = getProvider();
  const useImages = !!input.images?.length;
  const res = await provider.extractStructured({
    schemaName: SCHEMA_NAME,
    jsonSchema: buildJsonSchema(),
    prompt: useImages ? IMAGE_PROMPT : TEXT_PROMPT + (input.rawText ?? ""),
    images: input.images,
    maxTokens: 8000,
  });

  return { data: resumeExtraction.parse(res.data), usage: res.usage };
}
