/**
 * Agent — the "re-paint the whole CV" designer. Given the résumé's content, it
 * chooses visual style tokens (type scale, spacing, accent, font) that make the
 * page maximally readable. It does NOT touch content — only the look — so the
 * result is a styleConfig the user previews and accepts. Runs on the local
 * format-honoring model now; an OpenRouter frontier model can slot in later
 * behind getProvider() with zero changes here.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Agent } from "./types";
import { getProvider } from "@/llm";
import { redesignResult, type RedesignResult, FONT_KEYS } from "@/lib/redesign/schema";
// (template keys are described inline in the prompt below)

function jsonSchema(): Record<string, unknown> {
  const js = zodToJsonSchema(redesignResult, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function prompt(profileText: string, pages: number): string {
  return `You are a professional résumé designer. Choose visual style tokens that make THIS résumé maximally readable and polished on an A4 page. You are NOT rewriting content — only picking the look.

Return every token:
- nameScale: size of the person's name. 0.8–1.4 (1.0 = default). Larger for senior/executive profiles, modest for early-career.
- headerScale: size of section headings. 0.8–1.4.
- bodyScale: size of body text & bullets. 0.85–1.2. If the résumé is long/dense, go smaller to fit; if sparse, slightly larger.
- density: vertical spacing. 0.7–1.5. Lower to pack more onto one page; higher to let it breathe when there is room.
- accent: one professional accent color as a hex string like "#1f4e79". Tasteful, never neon. Match the field (deep blue/slate for finance & engineering; warmer tones for design/creative).
- font: exactly one of ${FONT_KEYS.join(", ")}. Serif (georgia/garamond/cambria) reads classic and formal; calibri/helvetica reads modern and clean.
- template: exactly one of clean, accent-name, ruled, serif-center — the sheet's layout personality:
  * clean — understated left-aligned default; safest for conservative fields
  * accent-name — the person's name set in the accent color; modern, warm, startup-friendly
  * ruled — a bold accent rule across the top; confident and graphic, suits senior/product profiles
  * serif-center — centered header with hairline section rules; formal, suits finance/law/academia
- rationale: one short sentence explaining the choices.

This résumé currently spans about ${pages} A4 page(s). Prefer a look that fits cleanly on as few pages as possible without feeling cramped.

RÉSUMÉ CONTENT:
${profileText}`;
}

export const resumeRedesigner: Agent<{ profileText: string; pages: number }, RedesignResult> = {
  name: "resume-redesigner",
  async run(input) {
    const provider = getProvider();
    const res = await provider.extractStructured({
      schemaName: "resume_style",
      jsonSchema: jsonSchema(),
      prompt: prompt(input.profileText, input.pages),
      maxTokens: 500,
    });
    return { output: redesignResult.parse(res.data), usage: res.usage };
  },
};
