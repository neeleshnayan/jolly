"use client";

import { useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";

type CallState = "idle" | "connecting" | "live" | "ended" | "error";

export default function MentorCall({ userId }: { userId: string }) {
  const vapiRef = useRef<Vapi | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [status, setStatus] = useState("Ready when you are.");
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    if (!key) {
      setConfigError("Set NEXT_PUBLIC_VAPI_PUBLIC_KEY in .env.local");
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
      setStatus("Call ended. Updating your map with what we talked about…");
    });
    vapi.on("speech-start", () => setStatus("Listening…"));
    vapi.on("speech-end", () => setStatus("Thinking…"));
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
  }, []);

  function start() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      setConfigError("Set NEXT_PUBLIC_APP_URL (public URL Vapi can reach)");
      return;
    }
    setState("connecting");
    setStatus("Connecting…");

    // Inline assistant: Vapi handles audio; our endpoint is the brain.
    // Vapi appends `/chat/completions` to model.url, so it hits
    // /api/voice/<userId>/chat/completions.
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
      // end-of-call report → our webhook → insight extraction onto the map
      server: { url: `${appUrl}/api/voice/webhook` },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function stop() {
    vapiRef.current?.stop();
  }

  if (configError) {
    return (
      <div className="upload-card">
        <h1>Voice not configured</h1>
        <p className="sub">{configError}</p>
      </div>
    );
  }

  return (
    <div className="upload-card" style={{ textAlign: "center" }}>
      <h1>Talk to your mentor</h1>
      <p className="sub">
        A short call. It probes, listens, and gets to know you — then updates
        your map with what it learns.
      </p>

      {state === "live" ? (
        <button className="btn" style={{ background: "#dc2626" }} onClick={stop}>
          End call
        </button>
      ) : (
        <button className="btn" onClick={start} disabled={state === "connecting"}>
          {state === "connecting" ? "Connecting…" : "Start call"}
        </button>
      )}

      <div className="status-line">{status}</div>
    </div>
  );
}
