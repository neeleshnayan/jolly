/**
 * PDF -> page images. We extract from images (the model sees the real layout)
 * rather than from scrambled text. Uses Poppler's pdftoppm to avoid PDF.js
 * worker/version conflicts between text extraction and rendering libraries.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ImagePart } from "@/llm";

const execFileAsync = promisify(execFile);

export async function renderPdfToImages(
  buffer: Buffer,
  opts?: { scale?: number; maxPages?: number },
): Promise<ImagePart[]> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resume-pdf-"));
  const inputPath = path.join(tmpDir, "resume.pdf");
  const outputPrefix = path.join(tmpDir, "page");
  const max = opts?.maxPages ?? 4;

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync(process.env.PDFTOPPM_PATH ?? "pdftoppm", [
      "-png",
      "-r",
      String(Math.round((opts?.scale ?? 2) * 72)),
      "-f",
      "1",
      "-l",
      String(max),
      inputPath,
      outputPrefix,
    ]);

    const files = (await readdir(tmpDir))
      .filter((file) => file.startsWith("page-") && file.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return Promise.all(
      files.map(async (file) => ({
        mediaType: "image/png" as const,
        dataBase64: (await readFile(path.join(tmpDir, file))).toString("base64"),
      })),
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
