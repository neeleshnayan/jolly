/**
 * Agent #1 — the résumé extractor, retrofitted into the agent contract.
 * It was the first thing we built and it already works, so it's the ideal
 * agent to prove the shape against before mentor / alignment / matching depend
 * on it. Pure: rawText in, structured extraction out. No DB here.
 */
import type { Agent } from "./types";
import { extractResume } from "@/lib/extraction/extract";
import type { ResumeExtraction } from "@/lib/extraction/schema";

export const resumeExtractor: Agent<{ rawText: string }, ResumeExtraction> = {
  name: "resume-extractor",
  async run(input) {
    const { data, usage } = await extractResume(input.rawText);
    return { output: data, usage };
  },
};
