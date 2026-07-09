/**
 * Prove OpenRouter STT + TTS end-to-end, and let us HEAR the voice + measure
 * latency — the two things that decide whether we move voice off the rig.
 * Round-trip: synthesize a mentor line → save the mp3 → transcribe it back and
 * check the text survives. No app config touched; reads the key from .env.local.
 *   npx tsx tools/test-openrouter-voice.ts
 * Then play the printed .mp3 to judge the voice.
 */
import { readFileSync, writeFileSync } from "node:fs";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0];
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      const hash = v.indexOf(" #");
      if (hash >= 0) v = v.slice(0, hash).trim();
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const BASE = "https://openrouter.ai/api/v1";

async function main() {
  loadEnvLocal();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not in .env.local");
  const auth = { authorization: `Bearer ${key}` };
  const dir = process.env.TEMP ?? ".";

  const line =
    "Neelesh, good to hear your voice again. Last time you were weighing the offer from Anthropic against the pull to build something of your own. Where has that landed?";

  // a shortlist of warm/conversational TTS voices to compare — model + a
  // best-guess voice; a wrong voice name usually comes back listing valid ones
  const candidates: { model: string; voice: string }[] = [
    { model: "hexgrad/kokoro-82m", voice: "am_michael" },
    { model: "sesame/csm-1b", voice: "conversational_a" },
    { model: "x-ai/grok-voice-tts-1.0", voice: "default" },
    { model: "google/gemini-3.1-flash-tts-preview", voice: "Charon" },
    { model: "canopylabs/orpheus-3b-0.1-ft", voice: "leo" },
  ];

  let firstMp3: Buffer | null = null;
  for (const c of candidates) {
    const slug = c.model.replace(/[^a-z0-9]+/gi, "-");
    const t0 = Date.now();
    const res = await fetch(`${BASE}/audio/speech`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ model: c.model, input: line, voice: c.voice, response_format: "mp3" }),
    });
    if (!res.ok) {
      console.log(`✗ ${c.model} (voice "${c.voice}") → ${res.status}: ${(await res.text()).slice(0, 160)}`);
      continue;
    }
    const mp3 = Buffer.from(await res.arrayBuffer());
    const ms = Date.now() - t0;
    const out = `${dir}\\drizzle-voice-${slug}.mp3`;
    writeFileSync(out, mp3);
    if (!firstMp3) firstMp3 = mp3;
    console.log(`✓ ${c.model} (voice "${c.voice}") → ${(mp3.length / 1024).toFixed(0)}KB in ${ms}ms  ·  ${out}`);
  }

  if (!firstMp3) {
    console.log("\nNo TTS model succeeded — check the voice names in the errors above.");
    process.exit(1);
  }

  // ---- STT head-to-head on the same clip (needs a funded account) ----
  // whisper-turbo vs parakeet vs whisper-large-v3 — same $0.0015/min for the
  // cheap ones, so this is really a latency + accuracy-on-your-voice bake-off.
  const sttModels = [
    "openai/whisper-large-v3-turbo",
    "nvidia/parakeet-tdt-0.6b-v3",
    "openai/whisper-large-v3",
  ];
  console.log(`\nSTT bake-off on the same clip:`);
  for (const m of sttModels) {
    const fd = new FormData();
    fd.append("file", new Blob([firstMp3], { type: "audio/mpeg" }), "line.mp3");
    fd.append("model", m);
    fd.append("language", "en");
    const t0 = Date.now();
    const res = await fetch(`${BASE}/audio/transcriptions`, { method: "POST", headers: auth, body: fd });
    if (!res.ok) {
      console.log(`  ✗ ${m} → ${res.status}: ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    const j = (await res.json()) as { text?: string; usage?: { cost?: number } };
    console.log(`  ✓ ${m}  (${Date.now() - t0}ms, $${j.usage?.cost ?? "?"})`);
    console.log(`      "${(j.text ?? "").trim()}"`);
  }
  console.log(`\nPlay the .mp3 files above to pick the mentor voice; STT numbers above pick the transcriber.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
