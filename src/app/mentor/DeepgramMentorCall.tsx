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

const CALL_LIMIT_SEC = 600; // 10-minute mentor call
const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export default function DeepgramMentorCall({ userId }: { userId: string }) {
  const { live, mode, status, turns, cards, mentors, error, levelRef, start, stop } = useDeepgramAgent();
  const [recap, setRecap] = useState<{ loading: boolean; summary: string; insights: Insight[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const [remaining, setRemaining] = useState(CALL_LIMIT_SEC);
  const startedAt = useRef<number | null>(null);

  // 10-min cap + live countdown. Ends the call at zero (recap fires from the
  // live→false effect). Ticks off wall-clock so it survives background throttling.
  useEffect(() => {
    if (!live) return;
    const started = startedAt.current ?? Date.now();
    const tick = () => {
      const left = CALL_LIMIT_SEC - Math.floor((Date.now() - started) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) stop();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live, stop]);

  // When a call ENDS — via the End button OR an unexpected drop — open the
  // "Since we spoke" follow-up. Keying off `live` (not the button) means a
  // dropped call still gets its recap instead of vanishing silently.
  useEffect(() => {
    if (live || recap || !startedAt.current) return;
    const userSaid = turns.filter((t) => t.role === "you").map((t) => t.text).join(" ").trim();
    if (userSaid.length < 30) return; // nothing meaningful to recap
    const transcript = turns.map((t) => `${t.role === "you" ? "You" : "Mentor"}: ${t.text}`).join("\n");
    setRecap({ loading: true, summary: "", insights: [] });
    fetch("/api/mentor/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, transcript }),
    })
      .then((r) => r.json())
      .then((j) => setRecap({ loading: false, summary: j.summary ?? "", insights: j.insights ?? [] }))
      .catch(() => setRecap({ loading: false, summary: "", insights: [] }));
  }, [live, recap, turns, userId]);

  async function begin() {
    setRecap(null);
    setSaved(false);
    setRemaining(CALL_LIMIT_SEC);
    startedAt.current = Date.now();
    await start();
  }

  function end() {
    // recap fires from the live→false effect above (covers button + drop)
    stop();
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

  // the mentor's latest utterance, cleaned of any bracketed stage-directions
  const spoken = ([...turns].reverse().find((t) => t.role === "mentor")?.text ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div className="dg-call">
      <style>{`
        .dg-caption { max-width: 660px; text-align: center; margin: 20px auto 4px; min-height: 44px;
          font-size: clamp(21px, 2.5vw, 29px); line-height: 1.48; font-weight: 500; letter-spacing: -0.01em;
          color: var(--fg); text-shadow: 0 0 30px rgba(208,122,84,0.14); }
        .dg-word { display: inline-block; opacity: 0; transform: translateY(11px); filter: blur(5px);
          animation: dgWordIn 0.52s cubic-bezier(0.22,1,0.36,1) forwards; }
        @keyframes dgWordIn { to { opacity: 1; transform: translateY(0); filter: blur(0); } }
        .dg-listening { color: var(--muted); font-style: italic; opacity: 0.7; animation: dgPulse 2.4s ease-in-out infinite; }
        @keyframes dgPulse { 0%,100% { opacity: 0.45; } 50% { opacity: 0.85; } }
        .dg-call { padding: 0 16px; }
        @media (max-width: 560px) { .dg-caption { font-size: 20px; max-width: 94vw; } }
      `}</style>
      <header className="dash-top">
        <Brand />
        <UserChip />
      </header>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 8 }}>
        <VoiceOrb mode={mode === "idle" || mode === "connecting" ? "ready" : mode} levelRef={levelRef} size={320} />
        <div style={{ fontWeight: 700, fontSize: 15 }}>Your mentor</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {live ? (
            <>LIVE · <span style={{ color: remaining <= 60 ? "#c0563c" : "inherit", fontWeight: remaining <= 60 ? 700 : 400 }}>{fmtClock(remaining)} left</span></>
          ) : (
            status
          )}
        </div>
        {error && <div style={{ color: "#c0563c", fontSize: 13 }}>{error}</div>}

        {/* cinematic live caption — the mentor's latest utterance revealed
            word-by-word (blur→clear), so it reads like they're speaking to you */}
        {live &&
          (spoken ? (
            <p key={spoken} className="dg-caption" aria-live="polite">
              {spoken.split(" ").map((w, i) => (
                <span className="dg-word" key={i} style={{ animationDelay: `${Math.min(i * 55, 1400)}ms`, marginRight: "0.28em" }}>
                  {w}
                </span>
              ))}
            </p>
          ) : (
            <p className="dg-caption dg-listening">{mode === "thinking" ? "thinking…" : "listening…"}</p>
          ))}

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

      {/* circle people the mentor named — "someone who's made your move" */}
      {mentors.length > 0 && (
        <div className="call-roles" style={{ marginTop: 16 }}>
          <div className="call-roles-head">Someone who&apos;s made your move</div>
          <div className="call-roles-row">
            {mentors.map((m, i) => (
              <div className="call-role" key={i} style={{ animationDelay: `${i * 100}ms` }}>
                <span className="call-role-kind">IN YOUR CIRCLE</span>
                <div className="call-role-title">{m.name}</div>
                {m.move && <div className="call-role-co">{m.move}</div>}
                {m.why && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>{m.why}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No chat-wall transcript — the live caption above IS the transcript,
          highlighting each utterance as it's spoken. Full transcript is still
          captured in `turns` for the post-call recap + review. */}

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
