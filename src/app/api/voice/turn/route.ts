/**
 * POST /api/voice/turn — one spoken exchange, fully local:
 *   audio (multipart) → Whisper STT → mentor LLM (Ollama) → LuxTTS → audio
 * The client holds the conversation and sends `history` each turn (stateless
 * server). Returns the transcribed user text, the mentor's reply text, and the
 * reply as base64 audio.
 */
import { NextResponse } from "next/server";
import { transcribe } from "@/lib/voice/voicebox";
import { parseTiming, timingNote } from "@/lib/voice/timing";
import { mentorTurn } from "@/agents/mentor/turn";
import { requireAdmin } from "@/lib/auth/admin";
import { resolveUserId } from "@/lib/auth/user";
import type { ChatMessage } from "@/llm";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("audio");
    const userId = form.get("userId");
    const historyRaw = form.get("history");
    const secondsLeftRaw = form.get("secondsLeft");
    const secondsLeft =
      typeof secondsLeftRaw === "string" && secondsLeftRaw !== "" ? Number(secondsLeftRaw) : undefined;

    // debug A/B: which brain answers this turn. Client requests are untrusted —
    // honor the override only in dev, or for a signed-in admin in production
    // (anyone else silently gets the configured default; no cloud-credit burning).
    const brainRaw = form.get("brain");
    let brain: string | undefined;
    if (typeof brainRaw === "string" && ["ollama", "anthropic"].includes(brainRaw)) {
      const allowed = process.env.NODE_ENV !== "production" || (await requireAdmin()) !== null;
      if (allowed) brain = brainRaw;
    }

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing 'audio'" }, { status: 400 });
    }
    // session decides whose mentor this is — the form field is dev-only fallback
    const resolvedUserId = await resolveUserId(typeof userId === "string" ? userId : null);
    if (!resolvedUserId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const history: ChatMessage[] =
      typeof historyRaw === "string" ? safeParse(historyRaw) : [];

    // 1. speech -> text
    const name = file instanceof File ? file.name : "turn.webm";
    const userText = await transcribe(file, name);
    if (!userText) {
      return NextResponse.json({ ok: true, userText: "", replyText: "", note: "no speech" });
    }

    // 2. text -> mentor reply (collect the streamed turn). The audio is streamed
    // separately via /api/voice/stream so playback starts as soon as the reply
    // is ready, instead of waiting for the whole clip.
    // The timing channel rides ONLY the current turn (history stays clean):
    // a strong deviation — long silence, slow/fast delivery, a barge-in —
    // becomes a one-line tone note ahead of the transcript.
    const note = timingNote(parseTiming(form.get("timing")), userText);
    const messages: ChatMessage[] = [...history, { role: "user", content: `${note}${userText}` }];
    let replyText = "";
    for await (const delta of mentorTurn({ userId: resolvedUserId, messages, secondsLeft, brain })) replyText += delta;
    replyText = replyText.trim();

    // the mentor signals it's wrapping up with a marker — strip it, flag it
    const ended = replyText.includes("[[END_CALL]]");
    replyText = replyText.replace(/\[\[END_CALL\]\]/g, "").trim();

    return NextResponse.json({ ok: true, userText, replyText, ended });
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
