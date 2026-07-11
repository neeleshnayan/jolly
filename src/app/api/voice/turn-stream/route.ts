/**
 * POST /api/voice/turn-stream — the STREAMING mentor turn.
 *   audio (multipart) → Whisper STT → mentor LLM → sentence segmentation
 * Emits newline-delimited JSON frames as the reply is generated, so the client
 * can fire TTS on sentence 1 while the model is still writing sentence 2:
 *   {"t":"user","text":…}                once, right after STT
 *   {"t":"sentence","seq":n,"text":…}    each complete sentence (stage-directions
 *                                        and [[END_CALL]] already stripped)
 *   {"t":"end","ended":bool,"replyText":…}  final; full reply for the transcript
 *   {"t":"nospeech"} | {"t":"error","message":…}
 * The legacy one-shot /api/voice/turn stays as the client's fallback path.
 */
import { NextResponse } from "next/server";
import { transcribe } from "@/lib/voice";
import { parseTiming, timingNote } from "@/lib/voice/timing";
import { makeSegmenter, makeMarkerFilter, cleanForSpeech } from "@/lib/voice/sentences";
import { mentorTurn } from "@/agents/mentor/turn";
import { detectDirectionRecs } from "@/lib/opportunities/direction";
import { requireAdmin } from "@/lib/auth/admin";
import { resolveUserId } from "@/lib/auth/user";
import type { ChatMessage } from "@/llm";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("audio");
  // A card-dive sends `text` instead of `audio` — same streaming turn, STT skipped.
  const textTurn = form.get("text");
  const hasText = typeof textTurn === "string" && textTurn.trim().length > 0;
  const userId = form.get("userId");
  const historyRaw = form.get("history");
  const secondsLeftRaw = form.get("secondsLeft");
  const secondsLeft =
    typeof secondsLeftRaw === "string" && secondsLeftRaw !== "" ? Number(secondsLeftRaw) : undefined;

  // debug A/B brain override — honored only in dev or for a signed-in admin
  // (untrusted client field; mirrors /api/voice/turn)
  const brainRaw = form.get("brain");
  let brain: string | undefined;
  if (typeof brainRaw === "string" && ["ollama", "anthropic"].includes(brainRaw)) {
    const allowed = process.env.NODE_ENV !== "production" || (await requireAdmin()) !== null;
    if (allowed) brain = brainRaw;
  }

  if (!hasText && !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'audio' or 'text'" }, { status: 400 });
  }
  const resolvedUserId = await resolveUserId(typeof userId === "string" ? userId : null);
  if (!resolvedUserId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const history: ChatMessage[] = typeof historyRaw === "string" ? safeParse(historyRaw) : [];
  const timing = form.get("timing");
  const name = file instanceof File ? file.name : "turn.webm";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        // 1. speech -> text (or take the text turn straight through, no STT)
        let userText: string;
        let sttMs = 0;
        if (hasText) {
          userText = (textTurn as string).trim();
        } else {
          const tStt0 = Date.now();
          userText = await transcribe(file as Blob, name);
          sttMs = Date.now() - tStt0;
        }
        if (!userText) {
          send({ t: "nospeech" });
          return;
        }
        send({ t: "user", text: userText });

        // B2 — live recs: if they named a direction to explore, pull real roles in
        // it that fit them → surface as dive-able cards + feed the mentor (best-effort).
        let extraBrief = "";
        try {
          const recs = await detectDirectionRecs(resolvedUserId, userText);
          if (recs) {
            extraBrief = recs.brief;
            send({ t: "cards", roles: recs.roles });
          }
        } catch {
          /* live recs never break the turn */
        }

        // 2. text -> mentor reply, streamed and segmented into sentences
        const note = timingNote(parseTiming(timing), userText);
        const messages: ChatMessage[] = [...history, { role: "user", content: `${note}${userText}` }];

        const seg = makeSegmenter();
        let ended = false;
        const marker = makeMarkerFilter("[[END_CALL]]", () => {
          ended = true;
        });
        let full = "";
        let seq = 0;
        const tGen0 = Date.now();
        let firstAt = 0;
        const emit = (sentences: string[]) => {
          for (const s of sentences) {
            if (!firstAt) firstAt = Date.now();
            send({ t: "sentence", seq: seq++, text: s });
          }
        };

        for await (const delta of mentorTurn({ userId: resolvedUserId, messages, secondsLeft, brain, extraBrief })) {
          const clean = marker.push(delta);
          if (!clean) continue;
          full += clean;
          emit(seg.push(clean));
        }
        const tail = marker.flush();
        if (tail) {
          full += tail;
          emit(seg.push(tail));
        }
        emit(seg.flush()); // whatever's left, spoken as the last sentence

        console.log(
          `[turn-stream] STT ${sttMs}ms · LLM→1st-sentence ${firstAt ? firstAt - tGen0 : -1}ms · gen-total ${Date.now() - tGen0}ms · ${seq} sentences`,
        );
        send({ t: "end", ended, replyText: cleanForSpeech(full) });
      } catch (err) {
        console.error("[/api/voice/turn-stream]", err);
        send({ t: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // proxies must not buffer a streamed body, or the latency win evaporates
      "x-accel-buffering": "no",
    },
  });
}

function safeParse(s: string): ChatMessage[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
