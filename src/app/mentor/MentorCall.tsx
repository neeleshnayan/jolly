"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; text: string };
type Insight = { dimension: string; content: string; confidence: number };
type Review = { loading: boolean; summary: string; insights: Insight[]; error?: string };

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

export default function MentorCall({ userId }: { userId: string }) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [spokenText, setSpokenText] = useState(""); // text of the line being spoken
  const [revealFrac, setRevealFrac] = useState(1); // how much of it to show (synced to audio)
  const [showTranscript, setShowTranscript] = useState(false); // hidden by default
  const [review, setReview] = useState<Review | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");

  // warm the STT/LLM/TTS models on page load so the first turn isn't cold
  useEffect(() => {
    fetch("/api/voice/warmup", { method: "POST" }).catch(() => {});
  }, []);

  // call timer
  useEffect(() => {
    if (!live) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [live]);

  function pushTurn(t: Turn) {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
  }
  function buildTranscript(list: Turn[]) {
    return list.map((t) => `${t.role === "user" ? "You" : "Mentor"}: ${t.text}`).join("\n");
  }
  function playAudio(b64: string, mime = "audio/wav", text = "") {
    audioRef.current?.pause();
    const audio = new Audio(`data:${mime};base64,${b64}`);
    audioRef.current = audio;
    setSpokenText(text);
    setRevealFrac(text ? 0 : 1);
    setSpeaking(true);
    // reveal the caption in step with the audio so it "prints as the mentor speaks"
    audio.ontimeupdate = () => {
      if (audio.duration) setRevealFrac(Math.min(1, audio.currentTime / audio.duration));
    };
    audio.onended = () => {
      setSpeaking(false);
      setRevealFrac(1);
    };
    audio.onerror = () => {
      setSpeaking(false);
      setRevealFrac(1);
    };
    void audio.play().catch(() => setSpeaking(false));
  }

  // auto-scroll the secondary transcript to the newest line
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, showTranscript]);

  async function startSession() {
    setError(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access is needed for the call. Allow it and try again.");
      return;
    }
    turnsRef.current = [];
    setTurns([]);
    setReview(null);
    setSaveState("idle");
    setSaveMsg("");
    setLive(true);
    setStatus("Getting up to speed on your background…");

    try {
      const res = await fetch("/api/voice/greeting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (res.ok && json.text) {
        pushTurn({ role: "assistant", text: json.text });
        if (json.audioBase64) playAudio(json.audioBase64, json.mime, json.text);
      } else {
        throw new Error(json.error || "greeting failed");
      }
    } catch {
      pushTurn({
        role: "assistant",
        text: "Hey — I'm your career mentor. Where are you in your search right now, and how's it feeling?",
      });
    }
    setStatus("Your turn — tap the mic and talk.");
  }

  function toggleRecording() {
    if (busy || !live) return;
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mr = new MediaRecorder(streamRef.current, { mimeType: pickMime() });
    mr.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
      void submitTurn(blob);
    };
    recorderRef.current = mr;
    audioRef.current?.pause(); // stop the mentor if the user jumps in
    setSpeaking(false);
    mr.start();
    setRecording(true);
    setStatus("Listening…");
  }

  async function submitTurn(blob: Blob) {
    setBusy(true);
    setStatus("Thinking…");
    try {
      const fd = new FormData();
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
      fd.append("audio", blob, `turn.${ext}`);
      fd.append("userId", userId);
      fd.append(
        "history",
        JSON.stringify(turnsRef.current.map((t) => ({ role: t.role, content: t.text }))),
      );
      const res = await fetch("/api/voice/turn", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Turn failed");

      if (!json.userText) {
        setStatus("Didn't catch that — tap the mic and try again.");
        return;
      }
      pushTurn({ role: "user", text: json.userText });
      if (json.replyText) pushTurn({ role: "assistant", text: json.replyText });
      if (json.audioBase64) playAudio(json.audioBase64, json.mime, json.replyText ?? "");
      setStatus("Your turn — tap the mic and talk.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function endSession() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioRef.current?.pause();
    setSpeaking(false);
    setLive(false);
    setRecording(false);
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
    } catch (err) {
      setReview({
        loading: false,
        summary: "",
        insights: [],
        error: err instanceof Error ? err.message : "Summary failed",
      });
    }
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

  const orbState = recording ? "listening" : busy ? "thinking" : speaking ? "speaking" : "idle";
  const stateLabel = recording
    ? "Listening…"
    : busy
      ? "Thinking…"
      : speaking
        ? "Mentor is speaking"
        : "Your turn — tap the mic";
  const lastTurn = turns[turns.length - 1];
  const caption = recording
    ? ""
    : speaking && spokenText
      ? revealWords(spokenText, revealFrac)
      : lastTurn?.text ?? "";

  return (
    <div className="call">
      <div className="call-topbar">
        <span className="brand">Career Co-Pilot</span>
        {live && (
          <button className="hangup" onClick={endSession}>
            End call
          </button>
        )}
      </div>

      {/* pre-call */}
      {!live && !review && (
        <div className="call-hero">
          <div className="orb idle">
            <div className="orb-face">🎧</div>
          </div>
          <h1>Talk to your mentor</h1>
          <p className="sub">
            A short voice call — it listens, replies out loud, and afterwards you
            review what it learned before it lands on your map.
          </p>
          <button className="btn call-cta" onClick={startSession}>
            Start call
          </button>
        </div>
      )}

      {/* in-call stage */}
      {live && (
        <div className="call-stage">
          <div className={`orb ${orbState}`}>
            <div className="orb-face">🎧</div>
          </div>
          <div className="call-name">Your mentor</div>
          <div className="call-timer">{fmtTime(elapsed)}</div>

          <div className="caption">
            <div className="caption-label">{stateLabel}</div>
            {caption && <div className="caption-text">{caption}</div>}
          </div>

          <div className="call-controls">
            <button
              className={`mic ${recording ? "on" : ""}`}
              onClick={toggleRecording}
              disabled={busy}
              title={recording ? "Stop and send" : "Tap to talk"}
            >
              {busy ? "…" : recording ? "■" : "🎙"}
            </button>
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

      {/* post-call review */}
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

              <div className="review-actions">
                <button
                  className="btn"
                  style={{ width: "auto", margin: 0, padding: "12px 28px" }}
                  onClick={saveReview}
                  disabled={saveState === "saving"}
                >
                  {saveState === "saving" ? "Saving…" : "Save to my map"}
                </button>
                <a className="ghost-btn" href={`/resume?u=${userId}`}>
                  Back to résumé →
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

// reveal a fraction of the text by whole words, so the caption keeps pace with speech
function revealWords(text: string, frac: number): string {
  const words = text.split(" ");
  const n = Math.max(1, Math.ceil(frac * words.length));
  return words.slice(0, n).join(" ");
}

// prefer a container the browser can actually record; whisper handles all of these
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
