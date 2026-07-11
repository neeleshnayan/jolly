"use client";

/**
 * The PROD mentor call — Deepgram Voice Agent (personalized Claude + live recs +
 * path capture) behind the app's own orb/transcript UI. Dev stays on MentorCall
 * (Kokoro pipeline); this renders when VOICE_PROVIDER=deepgram (or ?dg=1).
 * Post-call → the same summary+review flow, so insight reconcile (A) runs from
 * Deepgram calls too.
 */
import { useEffect, useRef, useState } from "react";
import Brand from "../Brand";
import UserChip from "../UserChip";
import VoiceOrb from "./VoiceOrb";
import { displayCompany } from "@/lib/format/company";
import { useDeepgramAgent } from "./useDeepgramAgent";

type Insight = { dimension: string; content: string; confidence: number; stance?: string; mode?: string; targetId?: string };

export default function DeepgramMentorCall({ userId }: { userId: string }) {
  const { live, mode, status, turns, cards, error, levelRef, start, stop } = useDeepgramAgent();
  const [recap, setRecap] = useState<{ loading: boolean; summary: string; insights: Insight[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const startedAt = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function begin() {
    setRecap(null);
    setSaved(false);
    startedAt.current = Date.now();
    await start();
  }

  async function end() {
    stop();
    const transcript = turns.map((t) => `${t.role === "you" ? "You" : "Mentor"}: ${t.text}`).join("\n");
    const userSaid = turns.filter((t) => t.role === "you").map((t) => t.text).join(" ").trim();
    if (userSaid.length < 30) return; // nothing to recap
    setRecap({ loading: true, summary: "", insights: [] });
    try {
      const res = await fetch("/api/mentor/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, transcript }),
      });
      const j = await res.json();
      setRecap({ loading: false, summary: j.summary ?? "", insights: j.insights ?? [] });
    } catch {
      setRecap({ loading: false, summary: "", insights: [] });
    }
  }

  async function saveToMap() {
    if (!recap) return;
    const transcript = turns.map((t) => `${t.role === "you" ? "You" : "Mentor"}: ${t.text}`).join("\n");
    try {
      await fetch("/api/mentor/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          transcript,
          insights: recap.insights,
          summary: recap.summary,
          durationSec: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : undefined,
        }),
      });
      setSaved(true);
    } catch {
      /* leave the button for a retry */
    }
  }

  return (
    <div className="dg-call">
      <header className="dash-top">
        <Brand />
        <UserChip />
      </header>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 8 }}>
        <VoiceOrb mode={mode === "idle" || mode === "connecting" ? "ready" : mode} levelRef={levelRef} size={260} />
        <div style={{ fontWeight: 700, fontSize: 15 }}>Your mentor</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{status}</div>
        {error && <div style={{ color: "#c0563c", fontSize: 13 }}>{error}</div>}

        {/* live caption — the mentor's latest words, front-and-centre. Deepgram
            sends whole turns (not token-streamed like the local path), so this
            shows the most recent mentor utterance rather than a per-token crawl. */}
        {live && (
          <p style={{ maxWidth: 560, textAlign: "center", fontSize: 17, lineHeight: 1.5, color: "var(--fg)", margin: "10px 0 2px", minHeight: 26 }}>
            {[...turns].reverse().find((t) => t.role === "mentor")?.text ?? ""}
          </p>
        )}

        {!live ? (
          <button className="explored-commit" style={{ marginTop: 12 }} onClick={begin}>
            {recap ? "Start another call" : "▶ Start your mentor call"}
          </button>
        ) : (
          <button className="explored-commit" style={{ marginTop: 12, background: "#333" }} onClick={end}>
            ■ End call
          </button>
        )}
      </div>

      {/* live direction recs the agent surfaced (B2) */}
      {cards.length > 0 && (
        <div className="call-roles" style={{ marginTop: 20 }}>
          <div className="call-roles-head">Roles the mentor found for you</div>
          <div className="call-roles-row">
            {cards.map((c, i) => (
              <div className="call-role" key={i} style={{ animationDelay: `${i * 100}ms` }}>
                {c.kind && <span className="call-role-kind">{c.kind}</span>}
                <div className="call-role-title">{c.title}</div>
                <div className="call-role-co">{displayCompany(c.company)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* live transcript */}
      {turns.length > 0 && (
        <div className="transcript" ref={transcriptRef} style={{ marginTop: 20, maxHeight: 260, overflowY: "auto" }}>
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role === "you" ? "user" : "assistant"}`}>
              <span className="say">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* post-call recap → feeds the graph (insight reconcile A) */}
      {recap && (
        <div className="dash-section" style={{ marginTop: 24 }}>
          <div className="dash-section-head"><h2>Since we spoke</h2></div>
          {recap.loading ? (
            <p className="dash-empty">Pulling out what we learned…</p>
          ) : (
            <>
              {recap.summary && <p style={{ fontSize: 14, lineHeight: 1.5 }}>{recap.summary}</p>}
              {recap.insights.length > 0 && (
                <ul style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>
                  {recap.insights.map((ins, i) => (
                    <li key={i}>
                      <b>{ins.dimension}</b>{ins.stance === "exploration" ? " (exploring)" : ""}: {ins.content}
                    </li>
                  ))}
                </ul>
              )}
              {!saved ? (
                <button className="explored-commit" onClick={saveToMap}>Save to your map →</button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div className="explored-committed">✓ Saved to your map</div>
                  {/* the payoff hop: send them to the list this call just retuned */}
                  <a className="explored-commit" href="/dashboard?retuning=1" style={{ textDecoration: "none" }}>
                    See your updated matches →
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
