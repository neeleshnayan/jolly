"use client";

/**
 * The Deepgram Voice Agent, as a reusable hook — the PROD mentor voice path.
 * Full-duplex over one websocket: Nova (STT) → Claude (think, with drizzle's real
 * personalized prompt) → Aura (TTS), plus client-side function-calling so the
 * mentor pulls live recs (B2) and captures explored paths (C) mid-call. Ported
 * from the /deepgram-test spike, now driving the real mentor UI (orb + cards +
 * transcript). Local dev stays on the Kokoro pipeline (MentorCall).
 */
import { useCallback, useRef, useState } from "react";
import { DEEPGRAM_FUNCTIONS } from "@/lib/voice/deepgram-functions";

const WS_URL = "wss://agent.deepgram.com/v1/agent/converse";
const IN_RATE = 16000;
const OUT_RATE = 24000;

export type DgTurn = { role: "you" | "mentor"; text: string };
export type DgCard = { kind?: string; title: string; company: string; why?: string };
export type DgMode = "idle" | "connecting" | "listening" | "thinking" | "speaking";

const GREETING = "Hey — good to see you. What's on your mind about where your career's headed right now?";
const FALLBACK_PROMPT =
  "You are the user's warm, sharp career mentor on a live voice call. Short natural sentences, one idea at a time, usually end with a real question. Help them explore where their career could go — and call fetch_recommendations when they name a direction.";

export function useDeepgramAgent(opts: { model?: string } = {}) {
  // Haiku is the default (free tier + cost): the personalized prompt + tools carry
  // the quality. Override with opts.model (e.g. Sonnet for Pro or hard turns).
  const model = opts.model ?? "claude-haiku-4-5";
  const [live, setLive] = useState(false);
  const [mode, setMode] = useState<DgMode>("idle");
  const [status, setStatus] = useState("idle");
  const [turns, setTurns] = useState<DgTurn[]>([]);
  const [cards, setCards] = useState<DgCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const levelRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const spkCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const nextTimeRef = useRef(0);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intentionalRef = useRef(false); // was the socket closed by us (End call) vs dropped?

  const playPCM = useCallback((buf: ArrayBuffer) => {
    const spk = spkCtxRef.current;
    if (!spk) return;
    const i16 = new Int16Array(buf);
    if (!i16.length) return;
    const f32 = new Float32Array(i16.length);
    let sum = 0;
    for (let i = 0; i < i16.length; i++) {
      const v = i16[i] / 32768;
      f32[i] = v;
      sum += v * v;
    }
    levelRef.current = Math.min(1, Math.sqrt(sum / i16.length) * 3.2); // orb reactivity
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
    intentionalRef.current = true;
    if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
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
    levelRef.current = 0;
    setLive(false);
    setMode("idle");
    setStatus("ended");
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    intentionalRef.current = false;
    setError(null);
    setTurns([]);
    setCards([]);
    setStatus("getting mic…");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError("Microphone access is needed for the call.");
      setStatus("mic denied");
      return;
    }
    streamRef.current = stream;

    // token
    let token: string;
    try {
      const r = await fetch("/api/deepgram/token");
      const j = await r.json();
      if (!r.ok || !j.token) throw new Error(j.error || "no token");
      token = j.token;
    } catch (e) {
      setError(`Voice unavailable: ${e instanceof Error ? e.message : String(e)}`);
      setStatus("token failed");
      return;
    }
    // personalized mentor prompt (drizzle's real mentor)
    let prompt = FALLBACK_PROMPT;
    let greeting = GREETING;
    try {
      const cr = await fetch("/api/voice/deepgram-config");
      const cj = await cr.json();
      if (cr.ok && cj.prompt) { prompt = cj.prompt; greeting = cj.greeting || GREETING; }
    } catch {
      /* fall back to the generic prompt */
    }

    setStatus("connecting…");
    setMode("connecting");
    const spk = new AudioContext({ sampleRate: OUT_RATE });
    spkCtxRef.current = spk;
    void spk.resume();

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL, ["token", token]);
    } catch (e) {
      setError(String(e));
      return;
    }
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

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
            const roles = (j.roles ?? []) as DgCard[];
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
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "FunctionCallResponse", id, name, content }));
      }
    };

    ws.onopen = () => {
      setLive(true);
      setStatus("connecting…");
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
            think: { provider: { type: "anthropic", model }, prompt, functions: DEEPGRAM_FUNCTIONS },
            speak: { provider: { type: "deepgram", model: "aura-2-pluto-en" } }, // deep, calm, empathetic baritone — the mentor voice
            greeting,
          },
        }),
      );
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
      proc.connect(mic.destination);
      // Deepgram drops idle sockets; a periodic KeepAlive prevents mid-call
      // disconnects during quiet stretches (the "call ended abruptly" bug).
      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, 8000);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") { playPCM(ev.data as ArrayBuffer); return; }
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (String(msg.type ?? "")) {
        case "SettingsApplied": setStatus("live"); setMode("listening"); break;
        case "ConversationText": {
          const role = msg.role === "user" ? "you" : "mentor";
          if (msg.content) setTurns((t) => [...t, { role, text: String(msg.content) }]);
          break;
        }
        case "UserStartedSpeaking": nextTimeRef.current = 0; setMode("listening"); break;
        case "AgentThinking": setMode("thinking"); break;
        case "AgentStartedSpeaking": setMode("speaking"); break;
        case "AgentAudioDone": setMode("listening"); levelRef.current = 0; break;
        case "FunctionCallRequest": void handleFunctionCall(msg); break;
        case "Error": setError(`Deepgram: ${JSON.stringify(msg)}`); break;
      }
    };

    ws.onclose = (ev) => {
      if (keepAliveRef.current) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
      setLive(false);
      setMode("idle");
      // if Deepgram (or the network) dropped us mid-call, say so instead of a
      // silent stop — 1000/1005-on-our-close is normal; anything else is a drop.
      if (!intentionalRef.current && ev.code !== 1000) {
        setError(`Call ended unexpectedly (code ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}). Tap start to resume.`);
        setStatus("dropped");
      }
    };
    ws.onerror = () => setError("voice socket error");
  }, [model, playPCM]);

  return { live, mode, status, turns, cards, error, levelRef, start, stop };
}
