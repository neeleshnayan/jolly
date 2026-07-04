/**
 * POST /api/voice/turn — one spoken exchange, fully local:
 *   audio (multipart) → Whisper STT → mentor LLM (Ollama) → LuxTTS → audio
 * The client holds the conversation and sends `history` each turn (stateless
 * server). Returns the transcribed user text, the mentor's reply text, and the
 * reply as base64 audio.
 */
import { NextResponse } from "next/server";
import { transcribe, synthesize } from "@/lib/voice/voicebox";
import { mentorTurn } from "@/agents/mentor/turn";
import type { ChatMessage } from "@/llm";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("audio");
    const userId = form.get("userId");
    const historyRaw = form.get("history");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing 'audio'" }, { status: 400 });
    }
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "Missing 'userId'" }, { status: 400 });
    }
    const history: ChatMessage[] =
      typeof historyRaw === "string" ? safeParse(historyRaw) : [];

    // 1. speech -> text
    const name = file instanceof File ? file.name : "turn.webm";
    const userText = await transcribe(file, name);
    if (!userText) {
      return NextResponse.json({ ok: true, userText: "", replyText: "", note: "no speech" });
    }

    // 2. text -> mentor reply (collect the streamed turn)
    const messages: ChatMessage[] = [...history, { role: "user", content: userText }];
    let replyText = "";
    for await (const delta of mentorTurn({ userId, messages })) replyText += delta;
    replyText = replyText.trim();

    // 3. reply -> speech
    const { audio, mime } = await synthesize(replyText);

    return NextResponse.json({
      ok: true,
      userText,
      replyText,
      audioBase64: audio.toString("base64"),
      mime,
    });
  } catch (err) {
    console.error("[/api/voice/turn]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

function safeParse(s: string): ChatMessage[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
