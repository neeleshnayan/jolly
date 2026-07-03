/**
 * POST /api/resume  — the résumé drop-in.
 * multipart: file (pdf/docx/txt) + userId (TEMP until auth is wired).
 * flow: parse -> source -> extract -> spine.
 */
import { NextRequest, NextResponse } from "next/server";
import { parseResumeFile } from "@/lib/extraction/parse";
import { runAgent } from "@/agents/run";
import { resumeExtractor } from "@/agents/resume-extractor";
import { ensureProfile } from "@/lib/profile/ensure";
import { persistExtraction } from "@/lib/profile/persist";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const userId = form.get("userId");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file'" }, { status: 400 });
    }
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing 'userId'" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // TODO: upload `buffer` to Supabase storage and set storagePath. rawText in
    // the source is the evidence that actually matters, so this is non-blocking.
    const storagePath: string | null = null;

    const rawText = await parseResumeFile(buffer, file.type, file.name);
    if (rawText.length < 30) {
      return NextResponse.json(
        { error: "Could not read enough text from the file" },
        { status: 422 },
      );
    }

    // ensure profile up front so the agent run is logged against it
    const profileId = await ensureProfile(userId);

    const { output: extraction } = await runAgent(
      resumeExtractor,
      { rawText },
      { userId, profileId },
    );

    const result = await persistExtraction({
      userId,
      extraction,
      rawText,
      storagePath,
    });

    return NextResponse.json({ ok: true, ...result, extraction });
  } catch (err) {
    console.error("[/api/resume]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
