/**
 * Voice provider router. Default is the local voicebox (rig GPU). Set
 * VOICE_PROVIDER=openrouter to move STT+TTS off the rig onto OpenRouter's
 * hosted audio endpoints — the app then runs anywhere (laptop, Vercel).
 *
 * Safety net: a routed call that throws (network blip, outage, no balance)
 * degrades to local voicebox instead of dropping the turn — best case cloud,
 * worst case what we had before. Disable with VOICE_FALLBACK_LOCAL=false.
 * The live streaming path falls back only on the INITIAL fetch failure (before
 * bytes flow); a mid-stream failure can't be seamlessly swapped.
 */
import * as voicebox from "./voicebox";
import * as openrouter from "./openrouter";

const useOpenRouter = () => (process.env.VOICE_PROVIDER ?? "voicebox").toLowerCase() === "openrouter";
const fallbackLocal = () => process.env.VOICE_FALLBACK_LOCAL !== "false";

function warn(what: string, e: unknown) {
  console.warn(`[voice] OpenRouter ${what} failed — falling back to voicebox:`, e instanceof Error ? e.message : e);
}

export async function transcribe(audio: Blob, filename?: string): Promise<string> {
  if (!useOpenRouter()) return voicebox.transcribe(audio, filename);
  try {
    return await openrouter.transcribe(audio, filename);
  } catch (e) {
    if (!fallbackLocal()) throw e;
    warn("STT", e);
    return voicebox.transcribe(audio, filename);
  }
}

export async function synthesize(text: string): Promise<{ audio: Buffer; mime: string }> {
  if (!useOpenRouter()) return voicebox.synthesize(text);
  try {
    return await openrouter.synthesize(text);
  } catch (e) {
    if (!fallbackLocal()) throw e;
    warn("TTS", e);
    return voicebox.synthesize(text);
  }
}

export async function synthesizeStream(text: string): Promise<Response> {
  if (!useOpenRouter()) return voicebox.synthesizeStream(text);
  try {
    return await openrouter.synthesizeStream(text);
  } catch (e) {
    if (!fallbackLocal()) throw e;
    warn("TTS stream", e);
    return voicebox.synthesizeStream(text);
  }
}

export async function warmVoice(): Promise<void> {
  // warm whichever backend will actually serve the call
  return useOpenRouter() ? openrouter.warmVoice() : voicebox.warmVoice();
}
