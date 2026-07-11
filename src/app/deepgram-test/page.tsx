"use client";

/**
 * DEEPGRAM VOICE AGENT SPIKE — throwaway page to FEEL the end-to-end experience:
 * mic → Deepgram Nova (STT) → Claude (think) → Deepgram Aura (TTS) → speaker,
 * full-duplex over one websocket. Start with Sonnet (the epitome), then dial the
 * model down to find the cheapest-yet-good.
 *
 * Deliberately LOUD: every Deepgram event / error / close reason prints to the
 * on-page log, so the first live run tells us the exact model string / auth flow
 * to correct (a few Deepgram specifics can't be verified without running it).
 *
 * Not linked in nav; not production. Uses raw WebSocket (no SDK) + Web Audio.
 */
import { useCallback, useRef, useState } from "react";
import { DEEPGRAM_FUNCTIONS } from "@/lib/voice/deepgram-functions";

const WS_URL = "wss://agent.deepgram.com/v1/agent/converse";
const IN_RATE = 16000; // mic → agent (linear16)
const OUT_RATE = 24000; // agent → speaker (linear16)

// Deepgram-managed Anthropic model strings for think.provider (from
// developers.deepgram.com/docs/voice-agent-llm-models). Sonnet = "Advanced"
// (epitome), Haiku = "Standard" (cheap — dial down to these).
// managed Anthropic models (Deepgram naming: claude-<family>-<ver>). Sonnet=Advanced,
// Haiku=Standard (cheap). claude-haiku-4-5 is the corrected 4.5 string.
const MODELS = ["claude-sonnet-5", "claude-haiku-4-5", "claude-3-5-haiku-latest", "claude-sonnet-4-5"];

// deep/mature/warm Aura-2 voices (bundled, no extra cost) — the Kokoro am_onyx vibe.
const VOICES = ["aura-2-pluto-en", "aura-2-mars-en", "aura-2-draco-en", "aura-2-atlas-en", "aura-2-orpheus-en"];

const MENTOR_PROMPT = `You are the user's career mentor on a live voice call — warm, sharp, genuinely curious. Talk like a person, not a chatbot: short natural sentences, one idea at a time, and usually end your turn with a real question. You help them EXPLORE where their career could go — different paths, bold pivots, what a role actually feels like day to day, who's made a similar jump. Be concrete and honest, never generic. Keep replies to 2–4 sentences so the conversation stays alive and back-and-forth.`;

const GREETING = "Hey — good to see you. So tell me: what's on your mind about where your career's headed right now?";

// function tools live in the shared module (DEEPGRAM_FUNCTIONS) so the spike + prod hook never drift.

type Card = { kind?: string; title: string; company: string; why?: string };
type Line = { role: "you" | "mentor" | "sys"; text: string };

export default function DeepgramTestPage() {
  const [model, setModel] = useState(MODELS[0]);
  const [voice, setVoice] = useState(VOICES[0]);
  const [status, setStatus] = useState("idle");
  const [live, setLive] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const spkCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const nextTimeRef = useRef(0);

  const log = useCallback((role: Line["role"], text: string) => {
    setLines((l) => [...l.slice(-80), { role, text }]);
  }, []);

  const playPCM = useCallback((buf: ArrayBuffer) => {
    const spk = spkCtxRef.current;
    if (!spk) return;
    const i16 = new Int16Array(buf);
    if (!i16.length) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const ab = spk.createBuffer(1, f32.length, OUT_RATE);
    ab.copyToChannel(f32, 0);
    const src = spk.createBufferSource();
    src.buffer = ab;
    src.connect(spk.destination);
    const t = Math.max(spk.currentTime + 0.02, nextTimeRef.current);
    src.start(t);
    nextTimeRef.current = t + ab.duration;
  }, []);

  const stop = useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try { procRef.current?.disconnect(); } catch {}
    procRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { micCtxRef.current?.close(); } catch {}
    try { spkCtxRef.current?.close(); } catch {}
    micCtxRef.current = spkCtxRef.current = null;
    nextTimeRef.current = 0;
    setLive(false);
    setStatus("stopped");
  }, []);

  const start = useCallback(async () => {
    // never stack sessions — close any prior socket first
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    setLines([]);
    setCards([]);
    setStatus("getting mic…");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setStatus("mic denied");
      return;
    }
    streamRef.current = stream;

    setStatus("minting token…");
    let token: string;
    try {
      const r = await fetch("/api/deepgram/token");
      const j = await r.json();
      if (!r.ok || !j.token) throw new Error(j.error || "no token");
      token = j.token;
      if (j.raw) log("sys", `⚠ using RAW key (grant failed: ${j.grantError ?? "?"})`);
    } catch (e) {
      setStatus("token failed");
      log("sys", `token error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Phase 1: pull drizzle's REAL personalized mentor prompt for this user, so
    // the agent knows their graph/spectrum/circle. Falls back to the generic one.
    let prompt = MENTOR_PROMPT;
    let greeting = GREETING;
    try {
      const cr = await fetch("/api/voice/deepgram-config");
      const cj = await cr.json();
      if (cr.ok && cj.prompt) {
        prompt = cj.prompt;
        greeting = cj.greeting || GREETING;
        log("sys", "loaded personalized mentor prompt ✓");
      } else {
        log("sys", `generic prompt (config: ${cj.error ?? "unavailable"})`);
      }
    } catch {
      log("sys", "generic prompt (config fetch failed)");
    }

    setStatus("connecting…");
    const spk = new AudioContext({ sampleRate: OUT_RATE });
    spkCtxRef.current = spk;
    // some browsers suspend a fresh context until a gesture — we're in a click
    void spk.resume();

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL, ["token", token]);
    } catch (e) {
      setStatus("ws ctor failed");
      log("sys", String(e));
      return;
    }
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // Phase 3: the agent calls our tools → we execute (fetch recs / capture path),
    // render cards, and send a FunctionCallResponse back. Shape parsed defensively
    // + logged raw, so the first run reveals Deepgram's exact request format.
    const handleFunctionCall = async (m: Record<string, unknown>) => {
      const raw = Array.isArray(m.functions) ? (m.functions as Record<string, unknown>[]) : [m];
      for (const c of raw) {
        const id = (c.id ?? c.function_call_id ?? m.function_call_id ?? m.id) as string | undefined;
        const name = (c.name ?? c.function_name ?? m.function_name) as string | undefined;
        let args: Record<string, unknown> = {};
        const a = c.arguments ?? c.input ?? m.input;
        if (typeof a === "string") { try { args = JSON.parse(a); } catch {} }
        else if (a && typeof a === "object") args = a as Record<string, unknown>;
        let content = "done";
        try {
          if (name === "fetch_recommendations") {
            const r = await fetch(`/api/mentor/recs?direction=${encodeURIComponent(String(args.direction ?? ""))}`);
            const j = await r.json();
            const roles = (j.roles ?? []) as Card[];
            setCards(roles);
            content = roles.length
              ? `Real roles that fit them: ${roles.map((x) => `${x.title} at ${x.company}`).join("; ")}. Offer these as concrete directions.`
              : "No specific openings in that space right now — keep it directional.";
          } else if (name === "open_path") {
            await fetch("/api/mentor/explored", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ label: args.role_title, company: args.company, kind: "A DIFFERENT PATH", source: "deepgram_dive" }),
            });
            content = `Saved — the user is now exploring ${String(args.role_title ?? "this path")}.`;
          } else {
            content = `Unknown function ${name}`;
          }
        } catch (e) {
          content = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "FunctionCallResponse", id, name, content }));
          log("sys", `↪ FunctionCallResponse (${name})`);
        }
      }
    };

    ws.onopen = () => {
      setStatus("configuring…");
      setLive(true); // flip the button to Stop immediately so a 2nd Start can't stack a session
      log("sys", "socket open → sending Settings");
      ws.send(
        JSON.stringify({
          type: "Settings",
          audio: {
            input: { encoding: "linear16", sample_rate: IN_RATE },
            output: { encoding: "linear16", sample_rate: OUT_RATE, container: "none" },
          },
          agent: {
            language: "en",
            listen: { provider: { type: "deepgram", model: "nova-3" } },
            think: { provider: { type: "anthropic", model }, prompt, functions: DEEPGRAM_FUNCTIONS }, // Phase 3: fn-calls; no temperature (deprecated on Sonnet-5)
            speak: { provider: { type: "deepgram", model: voice } },
            greeting,
          },
        }),
      );

      // mic → linear16 16k → agent
      const mic = new AudioContext({ sampleRate: IN_RATE });
      micCtxRef.current = mic;
      const srcNode = mic.createMediaStreamSource(stream);
      const proc = mic.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 32768 : s * 32767;
        }
        ws.send(i16.buffer);
      };
      srcNode.connect(proc);
      proc.connect(mic.destination); // silent (we never write output) — just to run the processor
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        playPCM(ev.data as ArrayBuffer);
        return;
      }
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const type = String(msg.type ?? "");
      switch (type) {
        case "Welcome":
          setStatus("connected");
          break;
        case "SettingsApplied":
          setStatus("live — talk to your mentor");
          setLive(true);
          break;
        case "ConversationText": {
          const role = msg.role === "user" ? "you" : "mentor";
          if (msg.content) log(role, String(msg.content));
          break;
        }
        case "UserStartedSpeaking":
          // barge-in: drop any queued agent audio
          nextTimeRef.current = 0;
          setStatus("listening…");
          break;
        case "AgentThinking":
          setStatus("thinking…");
          break;
        case "AgentStartedSpeaking":
          setStatus("speaking…");
          break;
        case "AgentAudioDone":
          setStatus("live — your turn");
          break;
        case "Error":
          log("sys", `❌ Deepgram Error: ${JSON.stringify(msg)}`);
          setStatus("error (see log)");
          break;
        case "Warning":
          log("sys", `⚠ ${JSON.stringify(msg)}`);
          break;
        case "FunctionCallRequest":
          log("sys", `↩ FunctionCallRequest: ${ev.data.slice(0, 260)}`);
          void handleFunctionCall(msg);
          break;
        default:
          log("sys", `· ${type}`);
      }
    };

    ws.onerror = () => log("sys", "socket error");
    ws.onclose = (e) => {
      log("sys", `socket closed (code ${e.code}${e.reason ? ` · ${e.reason}` : ""})`);
      setLive(false);
      if (status !== "stopped") setStatus("closed");
    };
  }, [model, voice, log, playPCM, status]);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Deepgram Voice Agent — spike</h1>
      <p style={{ color: "#888", fontSize: 14, marginTop: 0 }}>
        Nova (STT) → Claude (think) → Aura (TTS), full-duplex. Feel the epitome on Sonnet, then dial the model down.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "18px 0" }}>
        <label style={{ fontSize: 13, color: "#666" }}>think model:</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={live} style={{ padding: "6px 10px", borderRadius: 8 }}>
          {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label style={{ fontSize: 13, color: "#666" }}>voice:</label>
        <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={live} style={{ padding: "6px 10px", borderRadius: 8 }}>
          {VOICES.map((v) => <option key={v} value={v}>{v.replace("aura-2-", "").replace("-en", "")}</option>)}
        </select>
        {!live ? (
          <button onClick={start} style={{ padding: "8px 18px", borderRadius: 10, background: "#D07A54", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>
            ▶ Start call
          </button>
        ) : (
          <button onClick={stop} style={{ padding: "8px 18px", borderRadius: 10, background: "#333", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>
            ■ Stop
          </button>
        )}
        <span style={{ fontSize: 13, color: "#D07A54", fontWeight: 600 }}>{status}</span>
      </div>

      {cards.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
          {cards.map((c, i) => (
            <div key={i} style={{ border: "1px solid #e3d5cb", borderRadius: 10, padding: "9px 11px", minWidth: 160, background: "#fff" }}>
              {c.kind && <div style={{ fontSize: 10, fontWeight: 700, color: "#D07A54", textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.kind}</div>}
              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.title}</div>
              <div style={{ color: "#888", fontSize: 12 }}>{c.company}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, minHeight: 260, background: "#fafafa", fontSize: 14, lineHeight: 1.5 }}>
        {lines.length === 0 && <div style={{ color: "#aaa" }}>Transcript + Deepgram events will appear here…</div>}
        {lines.map((l, i) => (
          <div key={i} style={{ margin: "4px 0", color: l.role === "sys" ? "#9a7" : l.role === "you" ? "#357" : "#111" }}>
            <b style={{ textTransform: "uppercase", fontSize: 11, opacity: 0.7 }}>{l.role}</b>{" "}
            {l.text}
          </div>
        ))}
      </div>

      <p style={{ color: "#aaa", fontSize: 12, marginTop: 12 }}>
        If a model string is rejected, the ❌ Deepgram Error line will name the valid ones — swap it in the dropdown constant.
      </p>
    </div>
  );
}
