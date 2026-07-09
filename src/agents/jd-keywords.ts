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

const PROMPT = `Extract the concrete SKILL keywords an ATS (applicant tracking system) would screen this job description for.

- required: hard skills, tools, languages, frameworks, platforms, methodologies, or certifications clearly REQUIRED (max 15, most important first).
- preferred: the same kinds of terms, but mentioned as nice-to-have / bonus / preferred (max 10).

RULES:
- Each keyword is a concrete NOUN a résumé keyword-scanner could match: "Python", "Kubernetes", "dbt", "financial modeling", "CFA", "Series A fundraising".
- Keep each SHORT (1-3 words) with its CANONICAL capitalization (TypeScript, Next.js, PostgreSQL, dbt) — these can go onto a résumé, so casing matters. One concept per entry.
- NO duration or seniority requirements ("5+ years", "senior", "3 years experience") — those are screened separately, not here.
- NO degree/education requirements ("bachelor's", "master's degree", "phd").
- NO soft skills ("communication", "team player"), NO generic duties ("write code", "collaborate"), NO company/benefits fluff.
- Deduplicate: don't list both "ml" and "machine learning" — pick the fuller term once.

JOB DESCRIPTION:
---
`;

// The small model still leaks the odd duration/degree phrase or HTML crumb;
// scrub deterministically so the chips and the wizard's add-list stay clean.
// Exported so the ATS check can apply the SAME scrub to skills it reads straight
// from the vectorised opportunity (must_have/nice_to_have) — one clean source.
const DROP = /\b(years?|yrs?|experience|senior|junior|mid-?level|entry-?level|bachelor'?s?|master'?s?|phd|ph\.d|doctorate|degree|diploma|gpa)\b/i;
export function sanitize(terms: string[], maxLen = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    // preserve canonical casing (these go onto résumés) — matching lowercases
    // separately in the ATS check; only DEDUP is case-insensitive here
    const t = raw.replace(/<[^>]*>/g, "").replace(/["&]/g, "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > maxLen) continue; // empties, sentences
    if (DROP.test(t)) continue; // duration/seniority/education → screened elsewhere
    if (/^[\d+.\s-]+$/.test(t)) continue; // "5+", "3-5" and other bare numbers
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

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
        const parsed = jdKeywords.parse(res.data);
        return { output: { required: sanitize(parsed.required), preferred: sanitize(parsed.preferred) }, usage: res.usage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
};
