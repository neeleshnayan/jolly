/**
 * GET /api/voice/stream?text=…  — streaming TTS.
 * Pipes voicebox's chunked audio/wav straight to the browser so an <audio>
 * element plays the mentor's reply progressively (first sound in ~1s) instead of
 * waiting for the whole clip. GET so it can be an <audio> src.
 */
import type { NextRequest } from "next/server";
import { synthesizeStream } from "@/lib/voice/voicebox";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const text = req.nextUrl.searchParams.get("text");
  if (!text || !text.trim()) {
    return new Response("Missing text", { status: 400 });
  }
  const res = await synthesizeStream(text.trim());
  if (!res.ok || !res.body) {
    return new Response(`voicebox stream ${res.status}`, { status: 502 });
  }
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "audio/wav",
      "cache-control": "no-store",
    },
  });
}
