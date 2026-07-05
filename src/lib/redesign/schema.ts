import { z } from "zod";

// The fonts the redesign agent may choose from, mapped to real CSS stacks. The
// model picks a short key (robust for a local model); we expand it here.
export const FONT_KEYS = ["default", "georgia", "garamond", "cambria", "calibri", "helvetica"] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const fontKeyToCss: Record<FontKey, string> = {
  default: "",
  georgia: "Georgia, 'Times New Roman', serif",
  garamond: "Garamond, 'EB Garamond', Georgia, serif",
  cambria: "Cambria, Georgia, serif",
  calibri: "Calibri, 'Segoe UI', system-ui, sans-serif",
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
};

// Loose numbers/strings on purpose — a local model may drift out of range; we
// clamp and validate in toStyleConfig rather than rejecting the whole response.
export const redesignResult = z.object({
  nameScale: z.number(),
  headerScale: z.number(),
  bodyScale: z.number(),
  density: z.number(),
  accent: z.string(),
  font: z.enum(FONT_KEYS),
  rationale: z.string(),
});
export type RedesignResult = z.infer<typeof redesignResult>;

const clamp = (v: number, lo: number, hi: number) =>
  Math.round(Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 1)) * 100) / 100;
const HEX = /^#[0-9a-fA-F]{6}$/;

// Normalize a raw model result into a safe styleConfig the sheet can apply.
export function toStyleConfig(r: RedesignResult) {
  return {
    nameScale: clamp(r.nameScale, 0.8, 1.4),
    headerScale: clamp(r.headerScale, 0.8, 1.4),
    bodyScale: clamp(r.bodyScale, 0.85, 1.2),
    density: clamp(r.density, 0.7, 1.5),
    accent: HEX.test(r.accent) ? r.accent : "#2563eb",
    fontFamily: fontKeyToCss[r.font] ?? "",
  };
}
