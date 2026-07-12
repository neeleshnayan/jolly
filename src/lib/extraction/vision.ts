/**
 * Vision document reading — render a PDF to page images and have a vision model
 * transcribe each page to clean Markdown, preserving structure. This beats
 * glyph-position text extraction (parse.ts) on the layouts that break it:
 * multi-column and designed résumés, where dates/locations otherwise fly away
 * from their entries.
 *
 * Deliberately "document → text" (NOT "document → schema"): the vision model does
 * the one thing it's uniquely good at (layout-aware transcription), then the
 * existing, VALIDATED resume-extractor structures that text — so we don't
 * re-validate the extraction contract, and the intermediate Markdown is
 * human-inspectable. The shape mirrors Cloudflare Workers AI vision, so prod
 * swaps `transcribeImages` for the CF call with nothing downstream changing.
 *
 * Opt-in via RESUME_PARSE=vision (default off → the text path is untouched).
 */
const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const VISION_MODEL = process.env.RESUME_VISION_MODEL ?? "llama3.2-vision";
// prod runs vision on Cloudflare Workers AI; local dev on Ollama. (llama3.2-vision
// is dead on this local Ollama — mllama arch — so local uses gemma4; CF runs the
// real llama-3.2-11b-vision. See the compute-split note.)
// Same demarcation as the LLM: localhost → ollama; Cloudflare → OpenRouter
// (gemma-4 multimodal, off the CF neuron cap). Explicit RESUME_VISION_PROVIDER wins.
const VISION_PROVIDER = (process.env.RESUME_VISION_PROVIDER ?? (process.env.DEPLOY_TARGET === "cloudflare" ? "openrouter" : "ollama")).toLowerCase();
const CF_VISION_MODEL = process.env.CF_VISION_MODEL ?? "@cf/meta/llama-3.2-11b-vision-instruct";

/** Whether the vision parse path is enabled. */
export const VISION_PARSE_ON = (process.env.RESUME_PARSE ?? "").toLowerCase() === "vision";

const TRANSCRIBE_PROMPT =
  "You are a precise document transcriber. Transcribe this résumé/CV page to clean Markdown, EXACTLY as written — every name, company, job title, date, location, bullet point, and skill. Preserve the reading order and structure (section headings, entries, bullet lists). For multi-column layouts, keep each entry's dates and location WITH that entry, never in a separate block. Do NOT summarize, infer, reword, add, or omit anything. Output only the Markdown transcription, no commentary.";

/** Render each PDF page to a base64 PNG. scale=2 keeps small text legible. */
async function renderPdfToImages(buffer: Buffer): Promise<string[]> {
  // dynamic: pdf-to-img (native canvas) is Node-only. On CF it's aliased to empty
  // (next.config), so this throws and parse.ts falls back to the text path.
  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(buffer, { scale: 2 });
  const images: string[] = [];
  for await (const page of doc) {
    images.push(page.toString("base64"));
  }
  return images;
}

/** Cloudflare Workers AI vision transcription (OpenAI-compatible, base64 images). */
async function transcribeViaCloudflare(imagesBase64: string[]): Promise<string> {
  const account = process.env.CF_ACCOUNT_ID;
  const key = process.env.CF_API_TOKEN;
  if (!account || !key) throw new Error("CF_ACCOUNT_ID/CF_API_TOKEN not set for vision");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: CF_VISION_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            ...imagesBase64.map((b) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${b}` } })),
            { type: "text" as const, text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`CF vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

/** OpenRouter vision transcription (gemma-4 multimodal — off the CF neuron cap). */
async function transcribeViaOpenRouter(imagesBase64: string[]): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set for vision");
  const model = process.env.OPENROUTER_VISION_MODEL ?? process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(process.env.OPENROUTER_APP_URL ? { "HTTP-Referer": process.env.OPENROUTER_APP_URL } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            ...imagesBase64.map((b) => ({ type: "image_url" as const, image_url: { url: `data:image/png;base64,${b}` } })),
            { type: "text" as const, text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

/** One vision call → the page's Markdown. Per-page (not multi-image) so it stays
 *  robust across vision models that handle a single image best. Prod → OpenRouter,
 *  local → Ollama (CF Workers AI still available via RESUME_VISION_PROVIDER). */
async function transcribeImages(imagesBase64: string[]): Promise<string> {
  if (VISION_PROVIDER === "openrouter") return transcribeViaOpenRouter(imagesBase64);
  if (VISION_PROVIDER === "cloudflare") return transcribeViaCloudflare(imagesBase64);
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      stream: false,
      keep_alive: "1m", // stay warm across a multi-page résumé, then auto-unload
      think: false, // transcription, not reasoning — gemma4/qwen default-think would pollute output + add latency
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: "user", content: TRANSCRIBE_PROMPT, images: imagesBase64 }],
    }),
  });
  if (!res.ok) throw new Error(`vision transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { message?: { content?: string } };
  return (j.message?.content ?? "").trim();
}

/** Render a résumé PDF and transcribe it page-by-page to one Markdown string. */
export async function visionParsePdf(buffer: Buffer): Promise<string> {
  const images = await renderPdfToImages(buffer);
  const pages: string[] = [];
  for (const img of images) {
    pages.push(await transcribeImages([img]));
  }
  return pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
