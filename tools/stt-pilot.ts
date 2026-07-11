/**
 * STT PILOT — compare OpenRouter transcription models on accuracy + latency +
 * cost, locally, before switching the mentor's ear. Default candidates:
 *   openai/gpt-4o-mini-transcribe  (~$0.003/min — cheapest, newer)
 *   openai/whisper-large-v3-turbo  (~$0.006/min — what we run today; baseline)
 *
 * Test audio: by default we SYNTHESIZE a handful of domain-flavored phrases with
 * Kokoro (closed loop TTS→STT — needs OPENROUTER_API_KEY, off-rig) so the run is
 * fully automated and we know the reference text for WER. Drop in real mic clips
 * with --wav=path (repeatable) — those skip WER and just show transcript+latency.
 *
 *   npx tsx tools/stt-pilot.ts
 *   npx tsx tools/stt-pilot.ts --models=openai/gpt-4o-mini-transcribe,openai/whisper-large-v3-turbo
 *   npx tsx tools/stt-pilot.ts --wav=./sample.wav --wav=./sample2.wav
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]?\s*(#.*)?$/g, "");
}
process.env.VOICE_PROVIDER = "openrouter"; // synth + baseline both go through OpenRouter here

const argVals = (k: string) => process.argv.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.split("=").slice(1).join("="));
const arg = (k: string, d: string) => argVals(k)[0] ?? d;

const MODELS = arg("models", "openai/gpt-4o-mini-transcribe,openai/whisper-large-v3-turbo").split(",").map((s) => s.trim()).filter(Boolean);
const WAVS = argVals("wav");
const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

// ~$/min, for a rough cost column (verify against the dashboard before budgeting)
const RATE: Record<string, number> = {
  "openai/gpt-4o-mini-transcribe": 0.003,
  "openai/gpt-4o-transcribe": 0.006,
  "openai/whisper-large-v3-turbo": 0.006,
  "openai/whisper-large-v3": 0.006,
  "openai/whisper-1": 0.006,
};

// domain-flavored references: proper nouns, tech terms, numbers, comp — the
// stuff a mentor call actually says and a cheap model is most likely to fumble
const PHRASES = [
  "You'd move from Data Analyst to Analytics Engineer at Stripe within about eighteen months.",
  "The band is roughly one hundred sixty to one hundred ninety thousand, plus point three percent equity.",
  "Priya Sharma made that exact jump — Kubernetes, Airflow, and dbt were the load-bearing skills.",
  "Honestly, what's pulling you toward platform work rather than staying in analytics?",
];

function authKey(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("OPENROUTER_API_KEY is not set in .env.local");
  return k;
}

/** word-level error rate (Levenshtein over tokens), normalized to lowercase and
 *  stripped of punctuation so we score words, not commas. */
function wer(ref: string, hyp: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$. ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const a = norm(ref), b = norm(hyp);
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  return a.length ? d[a.length][b.length] / a.length : 0;
}

async function transcribeWith(model: string, audio: Blob, filename: string): Promise<{ text: string; ms: number }> {
  const fd = new FormData();
  fd.append("file", audio, filename);
  fd.append("model", model);
  fd.append("language", "en");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${authKey()}` }, body: fd });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as { text?: string };
  return { text: (json.text ?? "").trim(), ms };
}

type Clip = { label: string; ref: string | null; blob: Blob; filename: string };

async function buildClips(): Promise<Clip[]> {
  if (WAVS.length) {
    return WAVS.map((p, i) => {
      const buf = readFileSync(p);
      const ext = (p.split(".").pop() ?? "wav").toLowerCase();
      const mime = ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : "audio/wav";
      return { label: `wav#${i + 1} (${p.split(/[\\/]/).pop()})`, ref: null, blob: new Blob([buf], { type: mime }), filename: `clip${i + 1}.${ext}` };
    });
  }
  // synthesize the reference phrases with Kokoro (mp3)
  const { synthesize } = await import("../src/lib/voice");
  const clips: Clip[] = [];
  for (let i = 0; i < PHRASES.length; i++) {
    process.stdout.write(`  synth ${i + 1}/${PHRASES.length}…\r`);
    const { audio, mime } = await synthesize(PHRASES[i]);
    const ext = mime.includes("wav") ? "wav" : "mp3";
    clips.push({ label: `phrase#${i + 1}`, ref: PHRASES[i], blob: new Blob([audio], { type: mime }), filename: `clip${i + 1}.${ext}` });
  }
  process.stdout.write("                         \r");
  return clips;
}

async function main() {
  console.log(`STT PILOT — models: ${MODELS.join(", ")}\n${"=".repeat(78)}`);
  authKey(); // fail fast if no key
  const clips = await buildClips();
  console.log(`${WAVS.length ? "using provided wavs" : "synthesized Kokoro clips"}: ${clips.length}\n`);

  const agg: Record<string, { werSum: number; werN: number; msSum: number; n: number }> = {};
  for (const clip of clips) {
    console.log(`■ ${clip.label}${clip.ref ? `\n   ref: ${clip.ref}` : ""}`);
    for (const model of MODELS) {
      try {
        const { text, ms } = await transcribeWith(model, clip.blob, clip.filename);
        const w = clip.ref !== null ? wer(clip.ref, text) : null;
        const a = (agg[model] ??= { werSum: 0, werN: 0, msSum: 0, n: 0 });
        a.msSum += ms; a.n++;
        if (w !== null) { a.werSum += w; a.werN++; }
        console.log(`   ${model.padEnd(34)} ${String(ms).padStart(5)}ms${w !== null ? `  WER ${(w * 100).toFixed(1)}%` : ""}`);
        console.log(`      "${text}"`);
      } catch (e) {
        console.log(`   ${model.padEnd(34)} ✗ ${(e as Error).message}`);
      }
    }
    console.log("");
  }

  console.log(`${"=".repeat(78)}\nSUMMARY`);
  for (const model of MODELS) {
    const a = agg[model];
    if (!a || !a.n) { console.log(`   ${model}: no successful runs`); continue; }
    const rate = RATE[model];
    console.log(`   ${model.padEnd(34)} avg ${Math.round(a.msSum / a.n)}ms${a.werN ? ` · WER ${((a.werSum / a.werN) * 100).toFixed(1)}%` : ""}${rate ? ` · ~$${rate}/min` : ""}`);
  }
  console.log(`\nLower WER + lower latency + lower $/min wins. gpt-4o-mini-transcribe is the cheapest;\nswitch the mentor's ear by setting OPENROUTER_STT_MODEL if it holds up on domain terms.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
