"use client";

import { useEffect, useRef, useState } from "react";
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
const SILENCE_HANG_MS = 1000; // this much quiet ends your turn
const MIN_SPEECH_MS = 350; // ignore blips shorter than this
const POLL_MS = 60;
const CALIBRATION_MS = 700; // sample the room's noise floor at call start
const BARGE_FRAMES = 4; // ~240ms of sustained speech-shaped sound to interrupt
const SPEECH_BAND = [300, 3400]; // Hz — energy here is speech, not fan hum
const SPEECH_BAND_MIN = 0.32; // fraction of energy that must sit in the speech band

export default function MentorCall({ userId }: { userId: string }) {
  // media + analysis
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const freqRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0));
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
  const [review, setReview] = useState<Review | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

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
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [live]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, showTranscript]);

  function pushTurn(t: Turn) {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
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
    if (!text.trim()) {
      if (liveRef.current) {
        enter("idle");
        setStatus("Listening — just start talking.");
      }
      return;
    }
    const audio = new Audio(`/api/voice/stream?text=${encodeURIComponent(text)}`);
    audioRef.current = audio;
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
      if (liveRef.current) {
        enter("idle");
        setStatus("Listening — just start talking.");
      }
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
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
        speechThreshRef.current = Math.max(SPEECH_RMS, floor * 3);
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
    const stream = streamRef.current;
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
      const res = await fetch("/api/voice/turn", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Turn failed");
      if (!json.userText) {
        enter("idle");
        setStatus("Didn't catch that — go ahead.");
        return;
      }
      pushTurn({ role: "user", text: json.userText });
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
        // autoGainControl OFF: it boosts steady background (fan hum) in quiet
        // moments, which is exactly what causes false interruptions.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch {
      setError("Microphone access is needed for the call. Allow it and try again.");
      return;
    }
    // set up energy analysis for voice-activity detection
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(streamRef.current).connect(analyser);
    analyserRef.current = analyser;
    dataRef.current = new Float32Array(analyser.fftSize);
    freqRef.current = new Uint8Array(analyser.frequencyBinCount);
    calibrateNoiseFloor(); // measure the room over the next ~700ms

    turnsRef.current = [];
    setTurns([]);
    setReview(null);
    setShowTranscript(false);
    setSaveState("idle");
    setSaveMsg("");
    liveRef.current = true;
    setLive(true);
    enter("thinking");
    setStatus("Getting up to speed on your background…");
    vadTimerRef.current = window.setInterval(vadTick, POLL_MS);

    // mentor opens, personalized from the résumé/map
    try {
      const res = await fetch("/api/voice/greeting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (res.ok && json.text) {
        pushTurn({ role: "assistant", text: json.text });
        playText(json.text);
      } else throw new Error(json.error || "greeting failed");
    } catch {
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
    if (transcript.trim().length < 20) {
      setStatus("Ready when you are.");
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
        <span className="brand">Career Co-Pilot</span>
        <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
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

      {!live && !review && (
        <div className="call-hero">
          <div className="orb idle">
            <div className="orb-face">🎧</div>
          </div>
          <h1>Talk to your mentor</h1>
          <p className="sub">
            A short voice call — no buttons, just talk. It listens, replies out
            loud, and afterwards you review what it learned.
          </p>
          <button className="btn call-cta" onClick={startSession}>
            Start call
          </button>
        </div>
      )}

      {live && (
        <div className="call-stage">
          <div className={`orb ${orbClass}`}>
            <div className="orb-face">🎧</div>
          </div>
          <div className="call-name">Your mentor</div>
          <div className="call-timer">{fmtTime(elapsed)}</div>

          <div className="caption">
            <div className="caption-label">{label}</div>
            {caption && <div className="caption-text">{caption}</div>}
          </div>

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
