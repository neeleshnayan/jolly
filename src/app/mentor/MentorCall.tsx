"use client";

import { useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";

type CallState = "idle" | "connecting" | "live" | "ended" | "error";
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
  const vapiRef = useRef<Vapi | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const [state, setState] = useState<CallState>("idle");
  const [status, setStatus] = useState("Ready when you are.");
  const [configError, setConfigError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState<Turn | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");

  function buildTranscript(list: Turn[]) {
    return list.map((t) => `${t.role === "user" ? "You" : "Mentor"}: ${t.text}`).join("\n");
  }

  async function generateSummary() {
    const transcript = buildTranscript(turnsRef.current);
    if (transcript.trim().length < 20) return; // nothing worth summarizing
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

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    if (!key || key === "...") {
      setConfigError("Set NEXT_PUBLIC_VAPI_PUBLIC_KEY in .env.local (then restart the dev server)");
      return;
    }
    const vapi = new Vapi(key);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setState("live");
      setStatus("Connected — talk whenever you're ready.");
    });
    vapi.on("call-end", () => {
      setState("ended");
      setPartial(null);
      setStatus("Call ended. Pulling together a recap…");
      void generateSummary();
    });
    vapi.on("speech-start", () => setStatus("Listening…"));
    vapi.on("speech-end", () => setStatus("Thinking…"));

    // Live transcript. Vapi streams partial then final transcripts per speaker.
    vapi.on("message", (msg: unknown) => {
      const m = msg as { type?: string; role?: string; transcript?: string; transcriptType?: string };
      if (m.type !== "transcript" || !m.transcript) return;
      const role = m.role === "user" ? "user" : "assistant";
      if (m.transcriptType === "final") {
        const turn: Turn = { role, text: m.transcript };
        turnsRef.current = [...turnsRef.current, turn];
        setTurns(turnsRef.current);
        setPartial(null);
      } else {
        setPartial({ role, text: m.transcript });
      }
    });

    vapi.on("error", (e: unknown) => {
      setState("error");
      setStatus(
        "Something went wrong: " +
          (e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "unknown error"),
      );
    });

    return () => {
      vapi.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl || appUrl.includes("your-tunnel")) {
      setConfigError("Set NEXT_PUBLIC_APP_URL to your public tunnel URL (then restart the dev server)");
      return;
    }
    // reset for a fresh call
    turnsRef.current = [];
    setTurns([]);
    setPartial(null);
    setReview(null);
    setSaveState("idle");
    setSaveMsg("");
    setState("connecting");
    setStatus("Connecting…");

    vapiRef.current?.start({
      metadata: { userId },
      firstMessage:
        "Hey — I'm your career mentor. Before anything else, where are you in your search right now, and how's it feeling?",
      transcriber: { provider: "deepgram", model: "nova-2", language: "en" },
      voice: { provider: "cartesia", voiceId: "248be419-c632-4f23-adf1-5324ed7dbf1d" },
      model: {
        provider: "custom-llm",
        url: `${appUrl}/api/voice/${userId}`,
        model: "mentor",
      },
      server: { url: `${appUrl}/api/voice/webhook` },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function stop() {
    vapiRef.current?.stop();
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
      setSaveState("saved");
      setSaveMsg(`Saved ${json.count ?? insights.length} insight${(json.count ?? insights.length) === 1 ? "" : "s"} to your map ✓`);
    } catch (err) {
      setSaveState("error");
      setSaveMsg(err instanceof Error ? err.message : "Save failed");
    }
  }

  if (configError) {
    return (
      <div className="upload-card">
        <h1>Voice not configured</h1>
        <p className="sub">{configError}</p>
      </div>
    );
  }

  const hasTranscript = turns.length > 0 || partial;

  return (
    <div className="mentor">
      <div className="mentor-head">
        <div>
          <h1>Talk to your mentor</h1>
          <p className="sub">
            A short call. It probes, listens, and gets to know you — then you
            review what it heard before it lands on your map.
          </p>
        </div>
        {state === "live" ? (
          <button className="btn call-btn" style={{ background: "#dc2626" }} onClick={stop}>
            End call
          </button>
        ) : (
          <button
            className="btn call-btn"
            onClick={start}
            disabled={state === "connecting" || (review?.loading ?? false)}
          >
            {state === "connecting"
              ? "Connecting…"
              : state === "ended"
                ? "Start another call"
                : "Start call"}
          </button>
        )}
      </div>

      <div className="status-line">{status}</div>

      {/* live transcript */}
      {hasTranscript && (
        <div className="transcript">
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>
              <span className="who">{t.role === "user" ? "You" : "Mentor"}</span>
              <span className="say">{t.text}</span>
            </div>
          ))}
          {partial && (
            <div className={`bubble ${partial.role} partial`}>
              <span className="who">{partial.role === "user" ? "You" : "Mentor"}</span>
              <span className="say">{partial.text}</span>
            </div>
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
