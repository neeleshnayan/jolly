"use client";

/**
 * The Apply Kit — opens beside the ATS tab when the user clicks apply.
 * Everything staged, nothing typed twice: résumé PDF, cover letter (latest, or
 * generated against THIS job's JD), and copy-buttons for the fiddly answers
 * every form asks. The painful part of applying is never the typing — it's
 * hunting for the right version and re-deriving your answers.
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
      <aside className="applykit" onClick={(e) => e.stopPropagation()}>
        <div className="applykit-head">
          <div>
            <div className="applykit-kicker">apply kit</div>
            <div className="applykit-title">{jobTitle}</div>
          </div>
          <button className="ai-cancel" onClick={onClose}>✕</button>
        </div>
        <p className="applykit-sub">The form is open in the next tab — everything you need is staged here. You review, you submit.</p>

        {err && <div className="ai-err">{err}</div>}
        {!kit && !err && <p className="dash-empty">Staging your pack…</p>}

        {kit && (
          <>
            <div className="applykit-docs">
              <a className="btn-primary" href={`/api/resume/pdf?u=${userId}`} target="_blank" rel="noopener noreferrer">
                📄 Résumé PDF
              </a>
              {letterText ? (
                <button className="ghost-btn" onClick={() => void copy("letter", letterText)}>
                  {copied === "letter" ? "Copied ✓" : "✉ Copy cover letter"}
                </button>
              ) : null}
              {kit.job?.jd && (
                <button className="ghost-btn" onClick={() => void generateLetter()} disabled={letterBusy}>
                  {letterBusy ? "Writing…" : letterText ? "↻ Rewrite for this job" : "✉ Letter for this job"}
                </button>
              )}
            </div>
            {letterText && <textarea className="applykit-letter" value={letterText} onChange={(e) => setLetterText(e.target.value)} rows={5} />}

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
          </>
        )}
      </aside>
    </div>
  );
}
