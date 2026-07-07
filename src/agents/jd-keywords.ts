/**
 * Agent — pulls the checkable keywords out of a job description for the ATS
 * match check. Extraction only; the actual matching against the résumé is
 * DETERMINISTIC server code (an LLM judging "does the résumé contain X" would
 * hallucinate matches — string matching can't).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";

export const jdKeywords = z.object({
  // hard requirements: named skills/tools/qualifications an ATS would screen on
  required: z.array(z.string()).max(15),
  // nice-to-haves: mentioned but clearly optional
  preferred: z.array(z.string()).max(10),
});
export type JdKeywords = z.infer<typeof jdKeywords>;

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(jdKeywords, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

const PROMPT = `Extract the concrete, checkable keywords an ATS (applicant tracking system) would screen this job description for.

- required: skills, tools, languages, frameworks, certifications, and hard qualifications that are clearly REQUIRED (max 15, most important first).
- preferred: ones mentioned as nice-to-have / bonus / preferred (max 10).

RULES:
- Concrete nouns an exact-ish text match could find on a résumé: "Python", "Kubernetes", "Series A fundraising", "CFA", "5+ years backend".
- NO soft skills ("communication", "team player"), NO generic duties ("write code"), NO company fluff.
- Keep each keyword SHORT (1-4 words), in the JD's own vocabulary.

JOB DESCRIPTION:
---
`;

export const jdKeywordExtractor: Agent<{ jd: string }, JdKeywords> = {
  name: "jd-keyword-extractor",
  async run(input) {
    const provider = getProvider("ats");
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await provider.extractStructured({
          schemaName: "jd_keywords",
          jsonSchema: jsonSchema(),
          prompt: PROMPT + input.jd,
          maxTokens: 500,
          // small task — run it on the fast live model, not the 27B extractor;
          // keep it warm (it's the voice model) and never let it think
          model: process.env.OLLAMA_LIVE_MODEL || undefined,
          keepAlive: "5m",
          think: false,
        });
        return { output: jdKeywords.parse(res.data), usage: res.usage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
