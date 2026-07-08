"use client";

/**
 * The Apply Kit — a floating glass window layered over the dashboard while the
 * ATS form is open in the next tab. Left pane: the actual documents, readable
 * (résumé rendered true-to-print in an iframe; cover letter editable — latest
 * saved, or generated against THIS job's JD). Right pane: copy-ready answers.
 * The painful part of applying is never the typing — it's hunting for the
 * right version and re-deriving your answers.
 * EEOC/demographic questions are deliberately absent: those are the user's
 * alone to answer.
 */
import { useEffect, useState } from "react";

type Answer = { key: string; label: string; value: string | null };
type Kit = {
  answers: Answer[];
  letter: { content: string; label: string | null } | null;
  job: { title: string | null; company: string | null; url: string | null; jd: string } | null;
};

export default function ApplyKit({ userId, opportunityId, jobTitle, onClose }: { userId: string; opportunityId: string; jobTitle: string; onClose: () => void }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [letterText, setLetterText] = useState("");
  const [letterBusy, setLetterBusy] = useState(false);
  const [docTab, setDocTab] = useState<"resume" | "letter">("resume");

  useEffect(() => {
    fetch(`/api/apply-kit?u=${userId}&opportunityId=${opportunityId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setKit(j);
        setLetterText(j.letter?.content ?? "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't stage the kit"));
  }, [userId, opportunityId]);

  // Esc closes, like any window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard denied — the value is visible to select manually */
    }
  }

  async function generateLetter() {
    if (!kit?.job?.jd) return;
    setLetterBusy(true);
    setDocTab("letter");
    try {
      const r = await fetch("/api/resume/cover-letter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, jd: kit.job.jd }),
      });
      const j = await r.json();
      if (r.ok && j.letter) setLetterText(j.letter);
    } finally {
      setLetterBusy(false);
    }
  }

  return (
    <div className="applykit-overlay" onClick={onClose}>
      <section className="applykit applykit-window" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Apply kit">
        <div className="applykit-head">
          <div>
            <div className="applykit-kicker">apply kit</div>
            <div className="applykit-title">{jobTitle}</div>
          </div>
          <button className="ai-cancel" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="applykit-sub">The form is open in the next tab — everything you need is staged here. You review, you submit.</p>

        {err && <div className="ai-err">{err}</div>}
        {!kit && !err && <p className="dash-empty">Staging your pack…</p>}

        {kit && (
          <div className="applykit-panes">
            <div className="applykit-docs-pane">
              <div className="applykit-doc-tabs">
                <button className={`doc-tab${docTab === "resume" ? " active" : ""}`} onClick={() => setDocTab("resume")}>
                  📄 Résumé
                </button>
                <button className={`doc-tab${docTab === "letter" ? " active" : ""}`} onClick={() => setDocTab("letter")}>
                  ✉ Cover letter
                </button>
                <span className="applykit-doc-actions">
                  {docTab === "resume" && (
                    <a className="ghost-btn" href={`/api/resume/pdf?u=${userId}`} target="_blank" rel="noopener noreferrer">
                      ↓ PDF
                    </a>
                  )}
                  {docTab === "letter" && letterText && (
                    <button className="ghost-btn" onClick={() => void copy("letter", letterText)}>
                      {copied === "letter" ? "Copied ✓" : "⧉ Copy"}
                    </button>
                  )}
                  {docTab === "letter" && kit.job?.jd && (
                    <button className="ghost-btn" onClick={() => void generateLetter()} disabled={letterBusy}>
                      {letterBusy ? "Writing…" : letterText ? "↻ For this job" : "✨ Write it"}
                    </button>
                  )}
                </span>
              </div>
              {docTab === "resume" ? (
                <div className="applykit-resume-scroll">
                  {/* the print page IS the document — true fidelity, zero drift */}
                  <iframe className="applykit-resume-frame" src={`/resume/print?u=${userId}`} title="Your résumé" />
                </div>
              ) : letterText || letterBusy ? (
                <textarea
                  className="applykit-letter-full"
                  value={letterBusy && !letterText ? "Writing against this job's description…" : letterText}
                  onChange={(e) => setLetterText(e.target.value)}
                  readOnly={letterBusy}
                />
              ) : (
                <div className="applykit-letter-empty">
                  <p className="dash-empty">No letter yet — ✨ Write it drafts one against this job&apos;s description.</p>
                </div>
              )}
            </div>

            <div className="applykit-side">
              <div className="applykit-answers">
                {kit.answers.map((a) => (
                  <div className="applykit-answer" key={a.key}>
                    <span className="applykit-answer-label">{a.label}</span>
                    {a.value ? (
                      <span className="applykit-answer-value">
                        <span>{a.value}</span>
                        <button className="applykit-copy" onClick={() => void copy(a.key, a.value!)}>
                          {copied === a.key ? "✓" : "⧉"}
                        </button>
                      </span>
                    ) : (
                      <a className="applykit-missing" href="/insights" title="Pin this once — every future application reuses it">
                        pin it on About →
                      </a>
                    )}
                  </div>
                ))}
              </div>
              <p className="applykit-note">Diversity/EEOC questions aren&apos;t staged — those are yours alone to answer.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
