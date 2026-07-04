/**
 * Agent #1 — the résumé extractor. Prefers page images (multimodal) so the
 * model reads the real layout; falls back to reconstructed text. Pure: input
 * in, structured extraction out. No DB here.
 */
import type { Agent } from "./types";
import type { ImagePart } from "@/llm";
import { extractResume } from "@/lib/extraction/extract";
import type { ResumeExtraction } from "@/lib/extraction/schema";

export const resumeExtractor: Agent<
  { rawText?: string; images?: ImagePart[]; keepAlive?: string | number },
  ResumeExtraction
> = {
  name: "resume-extractor",
  async run(input) {
    const { data, usage } = await extractResume(input);
    return { output: data, usage };
  },
};
