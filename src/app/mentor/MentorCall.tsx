"use client";

import { useEffect, useRef, useState } from "react";
// type-only: the runtime import happens inside startSession — the module's
// RnnoiseWorkletNode extends AudioWorkletNode at class-definition time, which
// crashes SSR (no AudioWorkletNode in Node). Browser-only, loaded on demand.
import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import UserChip from "../UserChip";

type Phase = "idle" | "recording" | "thinking" | "speaking";
type Turn = { role: "user" | "assistant"; text: string };
type Insight = { dimension: string; content: string; confidence: number };
type Review = { loading: boolean; summary: string; insights: Insight[]; error?: string };
type Suggestion = {
  kind: "bullet" | "skill";
  text: string;
  rationale: string;
  entryKind: "experience" | "project" | null;
  entryId: string | null;
  entryLabel: string | null;
  status?: "added" | "dismissed";
};

const DIMENSIONS = [
  "aspiration",
  "energizer",
  "drainer",
  "value",
  "constraint",
  "goal",
  "pattern",
  "blocker",
];

// --- voice-activity tuning (all in one place; adjust to taste) ---
const SPEECH_RMS = 0.018; // floor for "counts as speech" (raised by calibration)
const BARGE_RMS = 0.05; // floor to interrupt the mentor mid-sentence
const SILENCE_HANG_MS = 1400; // this much quiet ends your turn (room for pauses)
const MIN_SPEECH_MS = 350; // ignore blips shorter than this
const POLL_MS = 60;
const CALIBRATION_MS = 700; // sample the room's noise floor at call start
const BARGE_FRAMES = 4; // ~240ms of sustained speech-shaped sound to interrupt
const SPEECH_BAND = [300, 3400]; // Hz — energy here is speech, not fan hum
const SPEECH_BAND_MIN = 0.32; // fraction of energy that must sit in the speech band
const CALL_LIMIT_SEC = 20 * 60; // countdown length; a focused call, extendable
const EXTEND_SEC = 5 * 60;

export default function MentorCall({ userId }: { userId: string }) {
  // media + analysis
  const streamRef = useRef<MediaStream | null>(null);
  const cleanStreamRef = useRef<MediaStream | null>(null); // RNNoise-denoised stream we actually record
  const rnnoiseRef = useRef<RnnoiseWorkletNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const freqRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0));
  // a second analyser tapped off the mentor's TTS so the orb reacts to ITS voice
  // while it speaks (the mic analyser reacts to the user's voice otherwise)
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceDataRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const voiceSrcRef = useRef<AudioNode | null>(null);
  const lastAudioErrRef = useRef<string>(""); // surfaced in the debug panel
  const orbRef = useRef<HTMLDivElement | null>(null); // drive --orb-level without re-rendering
  const vadTimerRef = useRef<number | null>(null);
  // adaptive thresholds — calibrated to the room's noise floor at call start
  const speechThreshRef = useRef(SPEECH_RMS);
  const bargeThreshRef = useRef(BARGE_RMS);
  const bargeCountRef = useRef(0);
  // refs the VAD loop reads without stale closures
  const liveRef = useRef(false);
  const recordingRef = useRef(false);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const speechStartRef = useRef(0);
  const lastVoiceRef = useRef(0);
  // conversation
  const turnsRef = useRef<Turn[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [live, setLive] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [spokenText, setSpokenText] = useState("");
  const [revealFrac, setRevealFrac] = useState(1);
  const [showTranscript, setShowTranscript] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [limitSec, setLimitSec] = useState(CALL_LIMIT_SEC);
  const limitRef = useRef(CALL_LIMIT_SEC); // mutable via "extend"
  const callStartRef = useRef(0);
  const endSessionRef = useRef<() => void>(() => {});
  const pendingEndRef = useRef(false); // mentor asked to close; end after it speaks
  const [review, setReview] = useState<Review | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  // 3 roles pre-picked for this call — revealed on screen only when the mentor
  // naturally brings them up (a surprise, not a spoiler).
  type CallRole = { kind: string; title: string; company: string; why: string };
  const spectrumRef = useRef<CallRole[]>([]);
  const [roleCards, setRoleCards] = useState<CallRole[] | null>(null);
  // debug A/B: which brain answers — local Ollama or Anthropic. Dev-only UI;
  // the server independently gates the override, so this is safe to render.
  const [brain, setBrain] = useState<"ollama" | "anthropic">("ollama");
  const brainRef = useRef(brain);
  brainRef.current = brain;
  // debug panel: live health of every voice-stack component (dev-only UI)
  type Health = {
    config: { liveModel: string; mentorProvider: string };
    voicebox: { up?: boolean; modelLoaded?: boolean; gpu?: string; vramMb?: number; error?: string };
    ollama: { up?: boolean; liveModelPulled?: boolean; models?: number; error?: string };
    generation: { ok?: boolean; latencyMs?: number; reply?: string; error?: string };
    checkedAt: string;
  };
  const [debugOpen, setDebugOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  async function checkHealth() {
    setHealthBusy(true);
    try {
      const r = await fetch("/api/voice/health", { cache: "no-store" });
      setHealth(await r.json());
    } catch {
      setHealth(null);
    } finally {
      setHealthBusy(false);
    }
  }
  function testSpeaker() {
    lastAudioErrRef.current = "";
    playText("Testing, one two three. If you can hear this, the speaker path works end to end.");
  }

  function enter(p: Phase) {
    setPhase(p);
    recordingRef.current = p === "recording";
    busyRef.current = p === "thinking";
    speakingRef.current = p === "speaking";
  }

  // warm the models on page load; run the call timer while live
  useEffect(() => {
    fetch("/api/voice/warmup", { method: "POST" }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (!callStartRef.current) return; // still connecting — the clock hasn't started
      const e = Math.floor((Date.now() - callStartRef.current) / 1000);
      setElapsed(e);
      if (e >= limitRef.current) endSessionRef.current(); // hard backstop at 0:00
    }, 1000);
    return () => clearInterval(id);
  }, [live]);
  // Speech-reactive orb: one rAF while live reads real amplitude (mentor's voice
  // while it speaks, else the mic) and writes --orb-level so a white dot grows /
  // shrinks with the sound. CSS-var only — no React renders, so it's near-free.
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      let level = 0;
      const va = voiceAnalyserRef.current;
      if (speakingRef.current && va) {
        const b = voiceDataRef.current;
        va.getFloatTimeDomainData(b);
        let s = 0;
        for (let i = 0; i < b.length; i++) s += b[i] * b[i];
        level = Math.sqrt(s / b.length);
      } else if (analyserRef.current) {
        level = computeRms(); // the user's mic
      }
      // speech RMS sits ~0.01–0.25 → map into 0..1 with a small noise floor
      const target = Math.max(0, Math.min(1, (level - 0.012) * 7));
      // fast attack, gentle release — lively but not jittery (Siri-like)
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.14);
      orbRef.current?.style.setProperty("--orb-level", smooth.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      orbRef.current?.style.setProperty("--orb-level", "0");
    };
  }, [live]);

  const remaining = Math.max(0, limitSec - elapsed);
  function extendCall() {
    limitRef.current += EXTEND_SEC;
    setLimitSec(limitRef.current);
  }
  endSessionRef.current = endSession; // live handle for timer / audio-end callbacks
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, showTranscript]);

  function pushTurn(t: Turn) {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
  }
  // reveal the role cards the moment the mentor actually names one of them
  function maybeRevealRoles(replyText: string) {
    if (roleCards || !spectrumRef.current.length) return;
    const t = replyText.toLowerCase();
    const named = spectrumRef.current.some(
      (r) => (r.title && t.includes(r.title.toLowerCase())) || (r.company && t.includes(r.company.toLowerCase())),
    );
    if (named) setRoleCards(spectrumRef.current);
  }
  function buildTranscript(list: Turn[]) {
    return list.map((t) => `${t.role === "user" ? "You" : "Mentor"}: ${t.text}`).join("\n");
  }

  // Stream the mentor's reply as it's synthesized: /api/voice/stream pipes
  // voicebox's chunked audio/wav, so playback starts in ~1s instead of waiting
  // for the whole clip. A streaming source often reports duration=Infinity, so
  // the caption reveal falls back to a words-per-second estimate.
  function playText(text: string) {
    audioRef.current?.pause();
    maybeRevealRoles(text); // if the mentor named a role, surface the cards
    if (!text.trim()) {
      if (liveRef.current) {
        enter("idle");
        setStatus("Listening — just start talking.");
      }
      return;
    }
    const audio = new Audio(`/api/voice/stream?text=${encodeURIComponent(text)}`);
    audioRef.current = audio;
    // Tap the mentor's voice for the reactive orb via captureStream(): a COPY of
    // the audio, so playback stays on the element's own output path. (The old
    // createMediaElementSource approach REROUTED playback through the AudioContext
    // — any graph hiccup meant total silence with no error. Never again.)
    audio.addEventListener(
      "playing",
      () => {
        const ctx = ctxRef.current;
        const cap = (audio as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.();
        if (!ctx || !cap || cap.getAudioTracks().length === 0) return;
        try {
          voiceSrcRef.current?.disconnect();
          const src = ctx.createMediaStreamSource(cap);
          if (!voiceAnalyserRef.current) {
            const va = ctx.createAnalyser();
            va.fftSize = 512;
            va.smoothingTimeConstant = 0.6;
            voiceAnalyserRef.current = va;
            voiceDataRef.current = new Float32Array(va.fftSize);
            // analysis only — NEVER connected to ctx.destination
          }
          src.connect(voiceAnalyserRef.current);
          voiceSrcRef.current = src;
        } catch {
          /* no orb reactivity this turn — audio is unaffected */
        }
      },
      { once: true },
    );
    setSpokenText(text);
    setRevealFrac(0);
    enter("speaking");
    const words = text.split(/\s+/).filter(Boolean).length;
    const estDur = Math.max(1.5, words / 2.7); // ~2.7 words/sec TTS pace
    audio.ontimeupdate = () => {
      const d = audio.duration && isFinite(audio.duration) ? audio.duration : estDur;
      setRevealFrac(Math.min(1, audio.currentTime / d));
    };
    const done = () => {
      setRevealFrac(1);
      if (pendingEndRef.current) {
        pendingEndRef.current = false;
        endSessionRef.current(); // the mentor's closing line just finished
        return;
      }
      if (liveRef.current) {
        enter("idle");
        setStatus("Listening — just start talking.");
      }
    };
    audio.onended = done;
    audio.onerror = () => {
      lastAudioErrRef.current = `audio element error (code ${audio.error?.code ?? "?"}: ${audio.error?.message || "unknown"}) at ${new Date().toLocaleTimeString()}`;
      done();
    };
    void audio.play().catch((e) => {
      lastAudioErrRef.current = `play() rejected: ${e instanceof Error ? e.message : String(e)} at ${new Date().toLocaleTimeString()}`;
      done();
    });
  }

  // ---- signal helpers ----
  function computeRms(): number {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(dataRef.current);
    let sum = 0;
    for (let i = 0; i < dataRef.current.length; i++) sum += dataRef.current[i] * dataRef.current[i];
    return Math.sqrt(sum / dataRef.current.length);
  }
  // fraction of spectral energy in the speech band. High for speech; low for
  // fan/AC hum (which lives mostly below 300 Hz).
  function speechBandFraction(): number {
    const analyser = analyserRef.current;
    const ctx = ctxRef.current;
    if (!analyser || !ctx) return 1;
    analyser.getByteFrequencyData(freqRef.current);
    const binHz = ctx.sampleRate / analyser.fftSize;
    const lo = Math.floor(SPEECH_BAND[0] / binHz);
    const hi = Math.min(freqRef.current.length - 1, Math.ceil(SPEECH_BAND[1] / binHz));
    let band = 0;
    let total = 0;
    for (let i = 0; i < freqRef.current.length; i++) {
      total += freqRef.current[i];
      if (i >= lo && i <= hi) band += freqRef.current[i];
    }
    return total > 0 ? band / total : 0;
  }
  // sample the room for ~700ms and set thresholds relative to its noise floor
  function calibrateNoiseFloor() {
    const samples: number[] = [];
    const t0 = performance.now();
    const id = window.setInterval(() => {
      samples.push(computeRms());
      if (performance.now() - t0 >= CALIBRATION_MS) {
        window.clearInterval(id);
        samples.sort((a, b) => a - b);
        const floor = samples[Math.floor(samples.length * 0.75)] ?? 0;
        // Only raise the BARGE threshold off the noise floor — leave the speech
        // threshold at its (low) default so a quiet or pausing voice still
        // registers and the user's turn isn't cut off mid-thought.
        bargeThreshRef.current = Math.max(BARGE_RMS, floor * 5);
      }
    }, 50);
  }

  // ---- the voice-activity loop: decides when you start and stop talking ----
  function vadTick() {
    const analyser = analyserRef.current;
    if (!analyser || !liveRef.current || busyRef.current) return;
    const rms = computeRms();
    const now = performance.now();
    const voiced = rms > speechThreshRef.current;

    if (speakingRef.current) {
      // interrupt the mentor only on sustained, speech-SHAPED, loud sound — a
      // brief fan spike (low-frequency, not sustained) no longer takes the floor
      if (rms > bargeThreshRef.current && speechBandFraction() > SPEECH_BAND_MIN) {
        if (++bargeCountRef.current >= BARGE_FRAMES) {
          bargeCountRef.current = 0;
          audioRef.current?.pause();
          beginRecording(now);
        }
      } else {
        bargeCountRef.current = 0;
      }
      return;
    }
    if (recordingRef.current) {
      if (voiced) lastVoiceRef.current = now;
      if (now - lastVoiceRef.current >= SILENCE_HANG_MS) endRecording(now);
    } else if (voiced) {
      beginRecording(now);
    }
  }

  function beginRecording(now: number) {
    const stream = cleanStreamRef.current ?? streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, { mimeType: pickMime() });
    } catch {
      mr = new MediaRecorder(stream);
    }
    mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
      void submitTurn(blob);
    };
    recorderRef.current = mr;
    mr.start();
    speechStartRef.current = now;
    lastVoiceRef.current = now;
    enter("recording");
    setStatus("I hear you…");
  }

  function endRecording(now: number) {
    const mr = recorderRef.current;
    recordingRef.current = false;
    if (!mr) return;
    if (now - speechStartRef.current < MIN_SPEECH_MS) {
      mr.onstop = null; // too short — discard, keep listening
      try {
        mr.stop();
      } catch {}
      enter("idle");
      setStatus("Listening — just start talking.");
      return;
    }
    try {
      mr.stop(); // → onstop → submitTurn
    } catch {}
  }

  async function submitTurn(blob: Blob) {
    enter("thinking");
    setStatus("Thinking…");
    try {
      // Whisper (via voicebox) decodes PCM WAV reliably but 500s on webm/opus,
      // so transcode to 16kHz mono WAV in the browser before sending.
      let audioBlob = blob;
      let filename = "turn.wav";
      try {
        audioBlob = await toWav(blob);
      } catch {
        filename = blob.type.includes("ogg") ? "turn.ogg" : "turn.webm";
      }
      const fd = new FormData();
      fd.append("audio", audioBlob, filename);
      fd.append("userId", userId);
      fd.append(
        "history",
        JSON.stringify(turnsRef.current.map((t) => ({ role: t.role, content: t.text }))),
      );
      const secondsLeft = callStartRef.current
        ? Math.max(0, limitRef.current - Math.floor((Date.now() - callStartRef.current) / 1000))
        : limitRef.current; // clock not started yet — report a full tank
      fd.append("secondsLeft", String(secondsLeft));
      fd.append("brain", brainRef.current); // debug A/B — server ignores unless dev/admin
      const res = await fetch("/api/voice/turn", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Turn failed");
      if (!json.userText) {
        enter("idle");
        setStatus("Didn't catch that — go ahead.");
        return;
      }
      pushTurn({ role: "user", text: json.userText });
      if (json.ended) pendingEndRef.current = true; // end the call after this reply plays
      if (json.replyText) {
        pushTurn({ role: "assistant", text: json.replyText });
        playText(json.replyText);
      } else {
        enter("idle");
        setStatus("Listening — just start talking.");
      }
    } catch (err) {
      enter("idle");
      setStatus(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function startSession() {
    setError(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        // Keep AGC + noiseSuppression on so the voice stays LOUD and steady fan
        // hum is filtered by the browser. (Fan-resistance for barge-in is handled
        // by speech-band gating below, not by starving the mic of gain.)
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError("Microphone access is needed for the call. Allow it and try again.");
      return;
    }
    // RNNoise assumes 48kHz. Route mic → RNNoise → (analyser + recorder), so the
    // VAD and Whisper both get denoised audio. Falls back to the raw mic if the
    // worklet/wasm can't load.
    const ctx = new AudioContext({ sampleRate: 48000 });
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const source = ctx.createMediaStreamSource(streamRef.current);
    try {
      // browser-only module — see the type-only import note at the top
      const { RnnoiseWorkletNode, loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
      await ctx.audioWorklet.addModule("/rnnoise/workletProcessor.js");
      const wasmBinary = await loadRnnoise({
        url: "/rnnoise/rnnoise.wasm",
        simdUrl: "/rnnoise/rnnoise_simd.wasm",
      });
      const rnnoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
      rnnoiseRef.current = rnnoise;
      const dest = ctx.createMediaStreamDestination();
      source.connect(rnnoise);
      rnnoise.connect(analyser); // VAD reads the cleaned signal
      rnnoise.connect(dest); // recorder captures the cleaned signal
      cleanStreamRef.current = dest.stream;
    } catch (e) {
      console.warn("[mentor] RNNoise unavailable, using raw mic", e);
      source.connect(analyser);
      cleanStreamRef.current = streamRef.current;
    }
    analyserRef.current = analyser;
    dataRef.current = new Float32Array(analyser.fftSize);
    freqRef.current = new Uint8Array(analyser.frequencyBinCount);
    calibrateNoiseFloor(); // measure the room over the next ~700ms

    turnsRef.current = [];
    setTurns([]);
    setReview(null);
    setRoleCards(null);
    callStartRef.current = 0; // the 20-min clock starts when the mentor SPEAKS, not now —
    // model warm-up and greeting generation shouldn't eat the user's call time
    limitRef.current = CALL_LIMIT_SEC;
    setLimitSec(CALL_LIMIT_SEC);
    setElapsed(0);
    pendingEndRef.current = false;
    setShowTranscript(false);
    setSaveState("idle");
    setSaveMsg("");
    liveRef.current = true;
    setLive(true);
    enter("thinking");
    setStatus("Getting your mentor on the line…");
    vadTimerRef.current = window.setInterval(vadTick, POLL_MS);

    // silently pre-load the 3-role spectrum; it's revealed only if the mentor
    // brings a role up during the call (a surprise, not a spoiler)
    fetch(`/api/opportunities/matches?u=${userId}`)
      .then((r) => r.json())
      .then((j) => {
        spectrumRef.current = (j.spectrum ?? []).map(
          (s: { kind: string; job: { title: string | null; company: string | null; why: string } }) => ({
            kind: s.kind,
            title: s.job.title ?? "",
            company: s.job.company ?? "",
            why: s.job.why,
          }),
        );
      })
      .catch(() => {});

    // Warm the voice stack WHILE the greeting is generated — both finish before
    // the clock starts, so cold-start (often ~10s) costs the user nothing.
    try {
      const [, res] = await Promise.all([
        fetch("/api/voice/warmup", { method: "POST" }).catch(() => null),
        fetch("/api/voice/greeting", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        }),
      ]);
      const json = await res.json();
      if (res.ok && json.text) {
        callStartRef.current = Date.now(); // NOW the 20 minutes begin
        pushTurn({ role: "assistant", text: json.text });
        playText(json.text);
      } else throw new Error(json.error || "greeting failed");
    } catch {
      callStartRef.current = Date.now();
      pushTurn({
        role: "assistant",
        text: "Hey — I'm your career mentor. Where are you in your search right now, and how's it feeling?",
      });
      enter("idle");
      setStatus("Listening — just start talking.");
    }
  }

  function endSession() {
    liveRef.current = false;
    if (vadTimerRef.current) clearInterval(vadTimerRef.current);
    const mr = recorderRef.current;
    if (mr) {
      mr.onstop = null;
      try {
        mr.stop();
      } catch {}
    }
    try {
      rnnoiseRef.current?.destroy();
    } catch {}
    rnnoiseRef.current = null;
    cleanStreamRef.current = null;
    try {
      voiceSrcRef.current?.disconnect();
    } catch {}
    voiceSrcRef.current = null;
    voiceAnalyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    audioRef.current?.pause();
    enter("idle");
    setLive(false);
    setStatus("Session ended. Pulling together a recap…");
    void generateSummary();
  }

  async function generateSummary() {
    const transcript = buildTranscript(turnsRef.current);
    // Gate on what the USER said — the mentor's own greeting is in the transcript,
    // so without this a silent call still produced a fully hallucinated recap.
    const userSaid = turnsRef.current
      .filter((t) => t.role === "user")
      .map((t) => t.text)
      .join(" ")
      .trim();
    if (userSaid.length < 30) {
      setStatus("We didn't really get to talk — no recap this time. Call again whenever you're ready.");
      return;
    }
    setReview({ loading: true, summary: "", insights: [] });
    try {
      const res = await fetch("/api/mentor/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, transcript }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not summarize");
      if (json.silent) {
        setReview(null);
        setStatus("We didn't really get to talk — no recap this time.");
        return;
      }
      setReview({ loading: false, summary: json.summary ?? "", insights: json.insights ?? [] });
      void generateSuggestions(transcript);
    } catch (err) {
      setReview({
        loading: false,
        summary: "",
        insights: [],
        error: err instanceof Error ? err.message : "Summary failed",
      });
    }
  }

  // the mentor→résumé feedback loop: things worth adding, one-tap to accept
  async function generateSuggestions(transcript: string) {
    setSuggestLoading(true);
    try {
      const res = await fetch("/api/resume/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, transcript }),
      });
      const json = await res.json();
      if (res.ok) setSuggestions(json.suggestions ?? []);
    } catch {
      /* non-fatal — suggestions are a bonus */
    } finally {
      setSuggestLoading(false);
    }
  }
  async function addSuggestion(i: number) {
    const s = suggestions?.[i];
    if (!s) return;
    setSuggestions((list) => list?.map((x, idx) => (idx === i ? { ...x, status: "added" } : x)) ?? null);
    try {
      await fetch("/api/resume/suggest/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          kind: s.kind,
          entryKind: s.entryKind,
          entryId: s.entryId,
          text: s.text,
        }),
      });
    } catch {
      /* leave marked; the résumé is source of truth */
    }
  }
  function dismissSuggestion(i: number) {
    setSuggestions((list) => list?.map((x, idx) => (idx === i ? { ...x, status: "dismissed" } : x)) ?? null);
  }

  // ---- review editing ----
  function editInsight(i: number, patch: Partial<Insight>) {
    setReview((r) =>
      r ? { ...r, insights: r.insights.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) } : r,
    );
  }
  function removeInsight(i: number) {
    setReview((r) => (r ? { ...r, insights: r.insights.filter((_, idx) => idx !== i) } : r));
  }
  function addInsight() {
    setReview((r) =>
      r ? { ...r, insights: [...r.insights, { dimension: "goal", content: "", confidence: 0.6 }] } : r,
    );
  }
  async function saveReview() {
    if (!review) return;
    setSaveState("saving");
    setSaveMsg("Saving to your map…");
    try {
      const insights = review.insights.filter((i) => i.content.trim().length > 0);
      const res = await fetch("/api/mentor/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, transcript: buildTranscript(turnsRef.current), insights }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      const n = json.count ?? insights.length;
      setSaveState("saved");
      setSaveMsg(`Saved ${n} insight${n === 1 ? "" : "s"} to your map ✓`);
    } catch (err) {
      setSaveState("error");
      setSaveMsg(err instanceof Error ? err.message : "Save failed");
    }
  }

  if (error) {
    return (
      <div className="upload-card">
        <h1>Can&apos;t start the call</h1>
        <p className="sub">{error}</p>
        <button className="btn" onClick={startSession}>
          Try again
        </button>
      </div>
    );
  }

  const orbClass =
    phase === "recording"
      ? "listening"
      : phase === "thinking"
        ? "thinking"
        : phase === "speaking"
          ? "speaking"
          : "ready";
  const label =
    phase === "recording"
      ? "I hear you…"
      : phase === "thinking"
        ? "Thinking…"
        : phase === "speaking"
          ? "Mentor is speaking"
          : "Listening — just start talking";
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  const caption =
    phase === "recording"
      ? ""
      : phase === "speaking" && spokenText
        ? revealWords(spokenText, revealFrac)
        : lastAssistant?.text ?? "";

  return (
    <div className="call">
      <div className="call-topbar">
        <span className="brand">drizzle</span>
        <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {process.env.NODE_ENV !== "production" && (
            <>
              <button
                className="brain-toggle"
                onClick={() => {
                  setDebugOpen((v) => !v);
                  if (!health) void checkHealth();
                }}
                title="Debug: health of voicebox + Ollama + the client audio path"
              >
                🔧
              </button>
              <button
                className={`brain-toggle${brain === "anthropic" ? " cloud" : ""}`}
                onClick={() => setBrain((b) => (b === "ollama" ? "anthropic" : "ollama"))}
                title="Debug: which model answers the next turn (local Ollama vs Anthropic)"
              >
                {brain === "anthropic" ? "🧠 Claude" : "🏠 Local"}
              </button>
            </>
          )}
          {live ? (
            <button className="hangup" onClick={endSession}>
              End call
            </button>
          ) : (
            <a className="ghost-btn" href="/dashboard">← Dashboard</a>
          )}
          <UserChip />
        </span>
      </div>

      {debugOpen && process.env.NODE_ENV !== "production" && (
        <div className="debug-panel">
          <div className="debug-panel-head">
            <span>Voice stack health</span>
            <span className="debug-panel-actions">
              <button className="tip-add" onClick={() => void checkHealth()} disabled={healthBusy}>
                {healthBusy ? "Checking…" : "↻ Re-check"}
              </button>
              <button className="tip-add" onClick={testSpeaker}>🔊 Test speaker</button>
            </span>
          </div>
          {!health ? (
            <div className="debug-line">{healthBusy ? "Probing voicebox + Ollama…" : "No data — hit Re-check."}</div>
          ) : (
            <>
              <div className={`debug-line ${health.voicebox.up ? "ok" : "bad"}`}>
                {health.voicebox.up ? "●" : "○"} voicebox (STT+TTS): {health.voicebox.error ?? `healthy · ${health.voicebox.gpu} · ${health.voicebox.vramMb}MB VRAM`}
              </div>
              <div className={`debug-line ${health.ollama.up && health.ollama.liveModelPulled ? "ok" : "bad"}`}>
                {health.ollama.up ? "●" : "○"} ollama: {health.ollama.error ?? `up · ${health.ollama.models} models · ${health.config.liveModel} ${health.ollama.liveModelPulled ? "pulled" : "MISSING"}`}
              </div>
              <div className={`debug-line ${health.generation.ok ? "ok" : "bad"}`}>
                {health.generation.ok ? "●" : "○"} live turn ({health.config.liveModel}):{" "}
                {health.generation.error ?? `${health.generation.latencyMs}ms → “${health.generation.reply}”`}
                {(health.generation.latencyMs ?? 0) > 5000 && !health.generation.error && " — SLOW: model may be cold or thinking"}
              </div>
              <div className="debug-line">
                mentor brain: {brain === "anthropic" ? "anthropic (toggle)" : health.config.mentorProvider} · client audio:{" "}
                {lastAudioErrRef.current || "no errors this session"}
              </div>
            </>
          )}
        </div>
      )}

      {!live && !review && (
        <div className="call-hero">
          <div className="hero-glow" aria-hidden />
          <div className="orb idle">
            <span className="orb-core" />
          </div>
          <h1>Talk to your mentor</h1>
          <p className="sub">
            No buttons, no forms — just a conversation. Your mentor already knows
            your résumé; it listens for who you&apos;re becoming.
          </p>
          <button className="btn call-cta" onClick={startSession}>
            Start the call
          </button>
          <div className="call-facts">
            <span>🎙 voice only</span>
            <span>⏱ 20 minutes</span>
            <span>🔒 stays on your machine</span>
          </div>
        </div>
      )}

      {live && (
        <div className="call-stage">
          <div className={`orb reactive ${orbClass}`} ref={orbRef}>
            <span className="orb-core" />
          </div>
          <div className="call-name">Your mentor</div>
          <div className={`call-timer${remaining <= 120 ? " low" : ""}`}>
            {fmtTime(remaining)} left
            {remaining <= 180 && remaining > 0 && (
              <button className="extend-btn" onClick={extendCall}>+5 min</button>
            )}
          </div>

          <div className="caption">
            <div className="caption-label">{label}</div>
            {caption && <div className="caption-text">{caption}</div>}
          </div>

          {roleCards && (
            <div className="call-roles">
              <div className="call-roles-head">Which of these pulls at you?</div>
              <div className="call-roles-row">
                {roleCards.map((r, i) => (
                  <div className="call-role" key={i} style={{ animationDelay: `${i * 120}ms` }}>
                    <span className="call-role-kind">{r.kind}</span>
                    <div className="call-role-title">{r.title}</div>
                    <div className="call-role-co">{r.company}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {turns.length > 0 && (
            <>
              <button className="link-btn" onClick={() => setShowTranscript((v) => !v)}>
                {showTranscript ? "Hide transcript" : "Show transcript"}
              </button>
              {showTranscript && (
                <div className="transcript" ref={transcriptRef}>
                  {turns.map((t, i) => (
                    <div key={i} className={`bubble ${t.role}`}>
                      <span className="say">{t.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {review && (
        <div className="review">
          <h2>Your recap</h2>
          {review.loading ? (
            <p className="sub">Reading back the conversation…</p>
          ) : review.error ? (
            <p className="status-line error">{review.error}</p>
          ) : (
            <>
              <textarea
                className="f recap"
                rows={Math.max(4, review.summary.split("\n").length + 1)}
                value={review.summary}
                onChange={(e) => setReview((r) => (r ? { ...r, summary: e.target.value } : r))}
              />

              <h2>What the mentor took away</h2>
              <p className="sub">
                Fix anything it got wrong — these become your map. Empty rows are skipped.
              </p>
              <div className="insight-list">
                {review.insights.map((ins, i) => (
                  <div className="insight-row" key={i}>
                    <select
                      className="f dim"
                      value={ins.dimension}
                      onChange={(e) => editInsight(i, { dimension: e.target.value })}
                    >
                      {DIMENSIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <input
                      className="f"
                      value={ins.content}
                      placeholder="what the mentor understood…"
                      onChange={(e) => editInsight(i, { content: e.target.value })}
                    />
                    <button className="x" onClick={() => removeInsight(i)} title="Remove">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button className="ghost-btn" onClick={addInsight}>
                + Add something
              </button>

              {(suggestLoading || (suggestions && suggestions.length > 0)) && (
                <div className="suggest-block">
                  <h2>Add to your résumé</h2>
                  <p className="sub">
                    Things you mentioned on the call that aren&apos;t on your résumé yet — one tap to add.
                  </p>
                  {suggestLoading && !suggestions && (
                    <p className="sub">Finding résumé-worthy moments from the call…</p>
                  )}
                  <div className="suggest-list">
                    {suggestions?.map((s, i) => (
                      <div className={`suggest-row ${s.status ?? ""}`} key={i}>
                        <div className="suggest-main">
                          <span className="suggest-kind">
                            {s.kind === "skill" ? "Skill" : s.entryLabel ?? "Bullet"}
                          </span>
                          <div className="suggest-text">{s.text}</div>
                          {s.rationale && <div className="suggest-why">{s.rationale}</div>}
                        </div>
                        {s.status === "added" ? (
                          <span className="suggest-added">Added ✓</span>
                        ) : s.status === "dismissed" ? (
                          <span className="suggest-dismissed">Dismissed</span>
                        ) : (
                          <div className="suggest-actions">
                            <button
                              className="suggest-add"
                              disabled={s.kind === "bullet" && !s.entryId}
                              title={s.kind === "bullet" && !s.entryId ? "Couldn't match a role — add it manually" : "Add to résumé"}
                              onClick={() => void addSuggestion(i)}
                            >
                              {s.kind === "bullet" && !s.entryId ? "No match" : "Add"}
                            </button>
                            <button className="suggest-dismiss" onClick={() => dismissSuggestion(i)}>
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="review-actions">
                <button
                  className="btn"
                  style={{ width: "auto", margin: 0, padding: "12px 28px" }}
                  onClick={saveReview}
                  disabled={saveState === "saving"}
                >
                  {saveState === "saving" ? "Saving…" : "Save to my map"}
                </button>
                <a className="ghost-btn" href="/resume">
                  Back to résumé →
                </a>
                <a className="ghost-btn" href="/debug" target="_blank" rel="noreferrer">
                  Debug: scores & insights ↗
                </a>
                <span className={`status-line ${saveState === "error" ? "error" : ""}`}>
                  {saveMsg}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmtTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function revealWords(text: string, frac: number): string {
  const words = text.split(" ");
  const n = Math.max(1, Math.ceil(frac * words.length));
  return words.slice(0, n).join(" ");
}

// Decode the recorded blob and re-encode as 16kHz mono 16-bit PCM WAV — the
// format Whisper ingests without an ffmpeg step on the server.
async function toWav(blob: Blob, targetRate = 16000): Promise<Blob> {
  const arr = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(arr);
    const chs = decoded.numberOfChannels;
    const len = decoded.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < chs; c++) {
      const d = decoded.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / chs;
    }
    // linear resample to targetRate
    const ratio = decoded.sampleRate / targetRate;
    const outLen = Math.max(1, Math.floor(len / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, len - 1);
      const frac = idx - i0;
      out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
    }
    // WAV container
    const buf = new ArrayBuffer(44 + outLen * 2);
    const view = new DataView(buf);
    const str = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    view.setUint32(4, 36 + outLen * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, outLen * 2, true);
    let off = 44;
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, out[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buf], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "audio/webm";
}
