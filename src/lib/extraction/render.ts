/**
 * PDF -> page images. We extract from images (the model sees the real layout)
 * rather than from scrambled text. Uses pdf-to-img (pdf.js + prebuilt canvas).
 */
import { pdf } from "pdf-to-img";
import type { ImagePart } from "@/llm";

export async function renderPdfToImages(
  buffer: Buffer,
  opts?: { scale?: number; maxPages?: number },
): Promise<ImagePart[]> {
  const doc = await pdf(buffer, { scale: opts?.scale ?? 2 });
  const max = opts?.maxPages ?? 4;
  const images: ImagePart[] = [];
  let i = 0;
  for await (const page of doc) {
    images.push({
      mediaType: "image/png",
      dataBase64: Buffer.from(page).toString("base64"),
    });
    if (++i >= max) break;
  }
  return images;
}
