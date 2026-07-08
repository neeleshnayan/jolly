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
- bulletGap: pixels between bullet lines, 0–12 (3 = default). Your second lever for fitting a page: 1–2 for dense résumés, 4–6 when there's room to breathe.
- accent: one professional accent color as a hex string like "#1f4e79". Tasteful, never neon. Match the field (deep blue/slate for finance & engineering; warmer tones for design/creative).
- font: exactly one of ${FONT_KEYS.join(", ")}. Serif (georgia/garamond/cambria) reads classic and formal; calibri/helvetica reads modern and clean.
- template: exactly one of clean, accent-name, ruled, serif-center, banner, bold, mono — the sheet's layout personality:
  * clean — understated left-aligned default; safest for conservative fields
  * accent-name — the person's name set in the accent color; modern, warm, startup-friendly
  * ruled — a bold accent rule across the top; confident and graphic, suits senior/product profiles
  * serif-center — centered header with hairline section rules; formal, suits finance/law/academia
  * banner — a warm gradient header band behind the name; refined and memorable, suits design/marketing/product
  * bold — oversized name with full-width tinted section bars; commands attention, suits leadership/sales/founder profiles
  * mono — dark header strip, monospace accents, code-tag skills; unmistakably an engineer's résumé
- rationale: one short sentence explaining the choices.

This résumé currently spans about ${pages} A4 page(s). THE GOAL IS ONE PAGE: recruiters skim, and a tight single page beats a roomy two every time. If it currently overflows, reach for smaller bodyScale, lower density, and a tighter bulletGap TOGETHER until one page is realistic — but never below the readable floor (bodyScale 0.85, density 0.7, bulletGap 1). If the content is simply too much for one readable page, two clean pages beat one cramped one — say so in the rationale.

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
