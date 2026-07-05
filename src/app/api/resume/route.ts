/**
 * POST /api/resume  — the résumé drop-in.
 * multipart: file (pdf/docx/txt) + userId (TEMP until auth is wired).
 * flow: parse -> source -> extract -> spine.
 */
import { NextRequest, NextResponse, after } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseResumeFile } from "@/lib/extraction/parse";
import { runAgent } from "@/agents/run";
import { resumeExtractor } from "@/agents/resume-extractor";
import { probeGenerator } from "@/agents/probe-generator";
import { ensureProfile } from "@/lib/profile/ensure";
import { persistExtraction } from "@/lib/profile/persist";
import { persistProbes } from "@/lib/probes/persist";
import { computeAndSaveScoring } from "@/lib/scoring/persist";
import { getProvider } from "@/llm";
import type { ResumeExtraction } from "@/lib/extraction/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

async function appendExtractionLog(entry: {
  userId: string;
  fileName: string;
  fileType: string;
  persisted: boolean;
  rawTextLength: number;
  imageCount: number;
  extraction: ResumeExtraction;
  usage?: { model: string; inputTokens?: number; outputTokens?: number };
}) {
  try {
    const logDir = path.join(process.cwd(), "logs");
    await mkdir(logDir, { recursive: true });
    await appendFile(
      path.join(logDir, "resume-extractions.ndjson"),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        counts: {
          experiences: entry.extraction.experiences.length,
          education: entry.extraction.education.length,
          skills: entry.extraction.skills.length,
          projects: entry.extraction.projects.length,
        },
        ...entry,
      })}\n`,
      "utf8",
    );
  } catch (err) {
    console.warn("[/api/resume] Could not write extraction log", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const userId = form.get("userId");
    const shouldPersist = form.get("persist") !== "false";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file'" }, { status: 400 });
    }
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing 'userId'" }, { status: 400 });
    }

    // Start loading the extraction model now, in parallel with parsing/rendering,
    // so it's hot by the time we call it (and it unloads itself right after).
    void getProvider().warm?.();

    const buffer = Buffer.from(await file.arrayBuffer());

    // TODO: upload `buffer` to Supabase storage and set storagePath. rawText in
    // the source is the evidence that actually matters, so this is non-blocking.
    const storagePath: string | null = null;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    // keep reconstructed text as the stored evidence (source.rawText) regardless
    const rawText = await parseResumeFile(buffer, file.type, file.name);

    // image-first extraction for PDFs (model reads the real layout), but keep
    // text extraction usable if local PDF rendering dependencies disagree.
    let images: Awaited<
      ReturnType<typeof import("@/lib/extraction/render").renderPdfToImages>
    > = [];
    if (isPdf) {
      try {
        const { renderPdfToImages } = await import("@/lib/extraction/render");
        images = await renderPdfToImages(buffer, { scale: 2 });
      } catch (err) {
        console.warn(
          "[/api/resume] PDF image rendering failed; falling back to text",
          err,
        );
      }
    }

    if (!images.length && rawText.length < 30) {
      return NextResponse.json(
        { error: "Could not read the file" },
        { status: 422 },
      );
    }

    // ensure profile up front so the agent run is logged against it
    const profileId = shouldPersist ? await ensureProfile(userId) : undefined;

    const { output: extraction, usage } = await runAgent(
      resumeExtractor,
      // keep the model warm for the probe pass that follows (only when persisting)
      { rawText, images, keepAlive: shouldPersist ? "60s" : undefined },
      { userId, profileId },
    );

    await appendExtractionLog({
      userId,
      fileName: file.name,
      fileType: file.type,
      persisted: shouldPersist,
      rawTextLength: rawText.length,
      imageCount: images.length,
      extraction,
      usage,
    });

    if (!shouldPersist) {
      return NextResponse.json({
        ok: true,
        persisted: false,
        counts: {
          experiences: extraction.experiences.length,
          education: extraction.education.length,
          skills: extraction.skills.length,
          projects: extraction.projects.length,
        },
        extraction,
      });
    }

    const result = await persistExtraction({
      userId,
      extraction,
      rawText,
      storagePath,
    });

    // Generate the mentor's probes AFTER the response is sent — the user goes
    // straight to the editor while gemma3 (still warm from extraction) works in
    // the background. `after` keeps this alive server-side even if they navigate
    // away; the model unloads once probes finish (default keep_alive).
    const willProbe = rawText.length > 50;
    if (willProbe) {
      after(async () => {
        try {
          const { output: probes } = await runAgent(
            probeGenerator,
            { rawText },
            { userId, profileId },
          );
          await persistProbes({ userId, extraction: probes, sourceId: result.sourceId });
        } catch (err) {
          console.warn("[/api/resume] probe generation failed (background)", err);
        }
      });
    }

    // Cache the initial scoring vector from the résumé, in the background, so the
    // "understanding" view serves it instantly instead of recomputing on open.
    after(async () => {
      try {
        await computeAndSaveScoring(userId);
      } catch (err) {
        console.warn("[/api/resume] scoring failed (background)", err);
      }
    });

    return NextResponse.json({ ok: true, ...result, probesPending: willProbe, extraction });
  } catch (err) {
    console.error("[/api/resume]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
