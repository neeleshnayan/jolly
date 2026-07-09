/**
 * Voicebox — local, GPU-accelerated STT + TTS running at 127.0.0.1:17493.
 * Replaces Vapi's paid cloud STT/voice: the mentor loop is now
 *   mic → transcribe() → LLM → synthesize() → speaker
 * all on-box, so a call costs nothing per second.
 *
 * Defaults are baked in so this works without any env, but each is overridable:
 *   VOICEBOX_BASE_URL, VOICEBOX_TTS_ENGINE, VOICEBOX_TTS_PROFILE_ID,
 *   VOICEBOX_STT_MODEL, VOICEBOX_STT_LANGUAGE
 */
const BASE = process.env.VOICEBOX_BASE_URL ?? "http://127.0.0.1:17493";
const TTS_ENGINE = process.env.VOICEBOX_TTS_ENGINE ?? "qwen"; // GPU, clones the profile
const TTS_MODEL_SIZE = process.env.VOICEBOX_TTS_MODEL_SIZE ?? "0.6B"; // qwen size
const STT_MODEL = process.env.VOICEBOX_STT_MODEL ?? "medium"; // whisper size
const STT_LANGUAGE = process.env.VOICEBOX_STT_LANGUAGE ?? "en";

// ---- STT: audio bytes -> text ----
export async function transcribe(
  audio: Blob,
  filename = "turn.webm",
): Promise<string> {
  const fd = new FormData();
  fd.append("file", audio, filename);
  fd.append("model", STT_MODEL);
  fd.append("language", STT_LANGUAGE);

  const res = await fetch(`${BASE}/transcribe`, { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(`voicebox STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

// ---- voice profile: prefer env, else the first profile the server has ----
let cachedProfileId: string | null = null;
async function resolveProfileId(): Promise<string> {
  if (process.env.VOICEBOX_TTS_PROFILE_ID) return process.env.VOICEBOX_TTS_PROFILE_ID;
  if (cachedProfileId) return cachedProfileId;
  const res = await fetch(`${BASE}/profiles`);
  if (!res.ok) throw new Error(`voicebox /profiles ${res.status}`);
  const list = (await res.json()) as Array<{ id: string }>;
  if (!Array.isArray(list) || !list.length) {
    throw new Error("No voicebox voice profile found — create one in the Voicebox app.");
  }
  cachedProfileId = list[0].id;
  return cachedProfileId;
}

// ---- TTS: text -> spoken audio bytes ----
// /generate returns a generation record; audio is fetched from /audio/{id}. The
// status may come back "completed" synchronously or need a brief poll, so we
// tolerate both.
interface Generation {
  id: string;
  status?: string;
  error?: string | null;
}

// /generate is async; its status endpoint is an SSE stream that emits progress
// then a terminal "completed"/"failed" event — but it keeps the socket open with
// keepalives afterward. We must ABORT the moment we see a terminal event, not
// wait for the server to close (that stalls ~40s). AbortController tears it down.
async function waitForGeneration(id: string): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${BASE}/generate/${id}/status`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) throw new Error(`voicebox status ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + 90_000;
  let buffer = "";
  let last = "generating";

  try {
    for (;;) {
      if (Date.now() > deadline) throw new Error("voicebox TTS timed out");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim()) as { status?: string };
          if (ev.status) last = ev.status;
          if (ev.status === "completed" || ev.status === "failed") return ev.status;
        } catch {
          /* ignore non-JSON keepalive lines */
        }
      }
    }
  } finally {
    controller.abort(); // drop the still-open SSE socket immediately
  }
  return last;
}

// Kokoro reads markdown literally ("asterisk asterisk"), so strip the symbols
// the mentor might emit before handing text to TTS. Keeps the words, drops the
// punctuation-as-formatting.
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images -> label
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // bold/italic
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // bullet markers
    .replace(/[*_~`#>]/g, "") // any stray markdown chars
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Streaming TTS: voicebox's /generate/stream returns chunked audio/wav so the
// browser can start playing before the whole clip exists. Returns the raw fetch
// Response; the route pipes its body straight to the client.
export async function synthesizeStream(text: string): Promise<Response> {
  const profileId = await resolveProfileId();
  return fetch(`${BASE}/generate/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile_id: profileId,
      text: toSpeakable(text),
      engine: TTS_ENGINE,
      model_size: TTS_MODEL_SIZE,
      language: "en",
    }),
  });
}

export async function synthesize(
  text: string,
): Promise<{ audio: Buffer; mime: string }> {
  const profileId = await resolveProfileId();

  const res = await fetch(`${BASE}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile_id: profileId,
      text: toSpeakable(text),
      engine: TTS_ENGINE,
      model_size: TTS_MODEL_SIZE, // ignored by non-qwen engines
      language: "en",
    }),
  });
  if (!res.ok) {
    throw new Error(`voicebox TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const gen = (await res.json()) as Generation;
  let status = gen.status ?? "completed";
  if (status !== "completed" && status !== "failed") {
    status = await waitForGeneration(gen.id);
  }
  if (status === "failed") {
    throw new Error(`voicebox TTS failed: ${gen.error ?? "unknown"}`);
  }

  const audioRes = await fetch(`${BASE}/audio/${gen.id}`);
  if (!audioRes.ok) throw new Error(`voicebox /audio ${audioRes.status}`);
  const mime = audioRes.headers.get("content-type") ?? "audio/wav";
  const audio = Buffer.from(await audioRes.arrayBuffer());
  return { audio, mime };
}

// A tiny silent WAV — enough to make voicebox load the Whisper model without a
// real recording. 16-bit mono PCM.
function silentWav(ms = 300, rate = 16000): Blob {
  const samples = Math.floor((rate * ms) / 1000);
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  return new Blob([buf], { type: "audio/wav" });
}

// Preload the STT + TTS models so the first real turn of a call isn't cold.
export async function warmVoice(): Promise<void> {
  await Promise.allSettled([
    synthesize("Ready when you are.").catch(() => {}),
    transcribe(silentWav(), "warmup.wav").catch(() => {}),
  ]);
}
