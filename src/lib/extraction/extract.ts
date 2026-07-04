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

// Strict output contract. `format` already constrains generation to the schema,
// but stating it in the prompt keeps weaker/chatty local models on the rails:
// no markdown fences, no commentary, exactly this shape.
const OUTPUT_CONTRACT = `Output contract:
- Return ONE JSON object and nothing else — no markdown fences, no prose before or after.
- It must match this shape exactly (types and keys); use null / [] for anything absent:
{
  "profile": { "fullName": string|null, "headline": string|null, "email": string|null, "phone": string|null, "location": string|null, "links": [{ "label": string, "url": string }] },
  "experiences": [{ "org": string|null, "title": string|null, "employmentType": string|null, "location": string|null, "startDate": string|null, "endDate": string|null, "isCurrent": boolean, "bullets": [string], "confidence": number }],
  "education": [{ "institution": string|null, "degree": string|null, "field": string|null, "startDate": string|null, "endDate": string|null, "details": string|null, "confidence": number }],
  "skills": [{ "name": string, "category": string|null, "confidence": number }],
  "projects": [{ "name": string|null, "description": string|null, "links": [{ "label": string, "url": string }], "bullets": [string], "confidence": number }]
}`;

const IMAGE_PROMPT = `These images are the pages of a résumé. Read the visual layout and extract its structured contents into the schema.
${RULES}

${OUTPUT_CONTRACT}`;

const TEXT_PROMPT = `Extract the structured contents of this résumé into the schema. The text was reconstructed from a PDF in reading order — each entry starts at its header line and owns the bullets that follow until the next header.
${RULES}

${OUTPUT_CONTRACT}

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
