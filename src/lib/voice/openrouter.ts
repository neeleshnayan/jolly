/**
 * OpenRouter voice — STT (/audio/transcriptions) + TTS (/audio/speech) on the
 * same key as the LLM. Drop-in for the voicebox functions so the mentor loop
 * can run off the rig entirely. Selected via VOICE_PROVIDER=openrouter (the
 * router in ./index falls back to local voicebox on any error).
 *
 * TTS returns mp3 (both voice routes pass content-type through). STT wants a
 * file — the client already transcodes the turn to WAV before it reaches us.
 */
import { toSpeakable } from "./voicebox";

const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
// large-v3-turbo, not large-v3: distilled, faster + cheaper ($0.04/hr), quality
// near-identical for English — "plenty of horsepower" without the heaviest model.
// (OpenRouter has no hosted "medium"; turbo is the right light equivalent.)
const STT_MODEL = process.env.OPENROUTER_STT_MODEL ?? "openai/whisper-large-v3-turbo";
// grok-voice-tts: warm, expressive, ~3-4s. Named voices: Eve, Ara, Rex, Sal, Leo.
const TTS_MODEL = process.env.OPENROUTER_TTS_MODEL ?? "x-ai/grok-voice-tts-1.0";
const TTS_VOICE = process.env.OPENROUTER_TTS_VOICE ?? "Leo";

function authKey(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("OPENROUTER_API_KEY is not set");
  return k;
}

export async function transcribe(audio: Blob, filename = "turn.wav"): Promise<string> {
  const fd = new FormData();
  fd.append("file", audio, filename);
  fd.append("model", STT_MODEL);
  fd.append("language", "en");
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${authKey()}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`OpenRouter STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

function speak(text: string): Promise<Response> {
  return fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${authKey()}`, "content-type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, input: toSpeakable(text), voice: TTS_VOICE, response_format: "mp3" }),
  });
}

/** Streaming TTS: the route pipes this Response's body straight to the browser. */
export async function synthesizeStream(text: string): Promise<Response> {
  const res = await speak(text);
  if (!res.ok) throw new Error(`OpenRouter TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function synthesize(text: string): Promise<{ audio: Buffer; mime: string }> {
  const res = await speak(text);
  if (!res.ok) throw new Error(`OpenRouter TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { audio: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "audio/mpeg" };
}

/** Hosted + stateless — nothing to preload. Kept for interface parity. */
export async function warmVoice(): Promise<void> {
  /* no-op: OpenRouter models are always warm */
}
