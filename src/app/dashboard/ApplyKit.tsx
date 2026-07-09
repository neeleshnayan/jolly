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
import AtsRing from "../AtsRing";
import DrizzleLoader from "../DrizzleLoader";

type Answer = { key: string; label: string; value: string | null };
type Kit = {
  answers: Answer[];
  letter: { content: string; label: string | null } | null;
  job: { title: string | null; company: string | null; url: string | null; jd: string } | null;
};

type PickVersion = { id: string; label: string | null; createdAt: string; theme: string | null };
type AtsSummary = { score: number; required: { term: string; hit: boolean }[]; preferred: { term: string; hit: boolean }[] };
/** The ranked read on this role (fit v2), passed from the card that opened us. */
export type RankedRead = {
  fit: number;
  desire: number;
  evidence: number | null;
  trajectory: number | null;
  reasons: string[];
  gaps: string[];
};

export default function ApplyKit({
  userId,
  opportunityId,
  jobTitle,
  ranked = null,
  onClose,
}: {
  userId: string;
  opportunityId: string;
  jobTitle: string;
  ranked?: RankedRead | null;
  onClose: () => void;
}) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [letterText, setLetterText] = useState("");
  const [letterHooks, setLetterHooks] = useState<string[]>([]);
  const [letterBusy, setLetterBusy] = useState(false);
  const [docTab, setDocTab] = useState<"resume" | "letter">("resume");
  // which résumé goes out: the live one, or any saved theme/version snapshot
  const [versions, setVersions] = useState<PickVersion[]>([]);
  const [pickedVersion, setPickedVersion] = useState("");
  const [versionState, setVersionState] = useState<"idle" | "loading" | "done">("idle");
  const [frameKey, setFrameKey] = useState(0); // bump to re-render the iframe after a restore
  // the print iframe carries the app's dark body background; a fixed-height
  // iframe left ~800px of that showing below a short résumé (the "black
  // component"). Measure the real content height on load and fit to it.
  const [frameH, setFrameH] = useState(2380);
  const fitFrame = (el: HTMLIFrameElement | null) => {
    if (!el) return;
    try {
      const h = el.contentDocument?.body?.scrollHeight ?? 0;
      if (h > 200) setFrameH(h + 16);
    } catch {
      /* same-origin, so this shouldn't throw — keep the default height if it does */
    }
  };
  // how this résumé fares against THIS job's keyword screen
  const [ats, setAts] = useState<AtsSummary | null>(null);
  const [atsBusy, setAtsBusy] = useState(false);
  // the what-if probe: tick a missing keyword to SIMULATE it on the résumé —
  // pure arithmetic (the server's exact formula), nothing is ever added for you
  const [simulated, setSimulated] = useState<Set<string>>(new Set());
  const scoreWith = (extra: Set<string>) => {
    if (!ats) return 0;
    const rs = ats.required.length ? ats.required.filter((k) => k.hit || extra.has(k.term)).length / ats.required.length : 1;
    const ps = ats.preferred.length ? ats.preferred.filter((k) => k.hit || extra.has(k.term)).length / ats.preferred.length : 1;
    return Math.round(100 * (0.8 * rs + 0.2 * ps));
  };
  const simScore = scoreWith(simulated);
  const deltaFor = (term: string) => scoreWith(new Set([...simulated, term])) - simScore;
  const toggleSim = (term: string) =>
    setSimulated((s) => {
      const next = new Set(s);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });

  useEffect(() => {
    fetch(`/api/apply-kit?u=${userId}&opportunityId=${opportunityId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        setKit(j);
        setLetterText(j.letter?.content ?? "");
        // how the résumé fares is part of the pack — check without being asked
        if (j.job?.jd) void runAtsWith(j.job.jd);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't stage the kit"));
    fetch(`/api/track/version?u=${userId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const themes = (j.themes ?? []) as { name: string; versions: Omit<PickVersion, "theme">[] }[];
        const untagged = (j.untagged ?? []) as Omit<PickVersion, "theme">[];
        setVersions([
          ...themes.flatMap((t) => t.versions.map((v) => ({ ...v, theme: t.name }))),
          ...untagged.map((v) => ({ ...v, theme: null })),
        ]);
      })
      .catch(() => {});
  }, [userId, opportunityId]);

  // swap the outgoing résumé: restore the snapshot into the live résumé, then
  // re-render the preview. Reversible — every version stays saved.
  async function useVersion() {
    if (!pickedVersion) return;
    setVersionState("loading");
    try {
      const r = await fetch("/api/track/version/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, versionId: pickedVersion }),
      });
      if (!r.ok) throw new Error();
      setFrameKey((k) => k + 1);
      setAts(null); // the ATS result belongs to the previous résumé
      setVersionState("done");
      setTimeout(() => setVersionState("idle"), 2000);
    } catch {
      setVersionState("idle");
    }
  }

  async function runAtsWith(jd: string) {
    setAtsBusy(true);
    try {
      const r = await fetch("/api/resume/ats-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // opportunityId lets the server reuse the job's vectorised skills — no LLM
        body: JSON.stringify({ userId, jd, opportunityId }),
      });
      const j = await r.json();
      if (r.ok) {
        setAts(j);
        setSimulated(new Set()); // a fresh read starts from reality
      }
    } finally {
      setAtsBusy(false);
    }
  }
  const runAts = () => kit?.job?.jd && void runAtsWith(kit.job.jd);

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
      if (r.ok && j.letter) {
        setLetterText(j.letter);
        setLetterHooks(j.hooks ?? []); // the WHY behind the letter, shown above it
        // remember it against THIS job so reopening the kit shows it, not a redraft
        const label = kit.job.title ? `For ${kit.job.title}` : "For this job";
        void fetch("/api/cover-letters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ u: userId, content: j.letter, label, jd: kit.job.jd, opportunityId }),
        }).catch(() => {});
      }
    } finally {
      setLetterBusy(false);
    }
  }

  // The kit's promise is "everything staged." We no longer prefill a letter
  // written for another job, so the first time the user opens the Cover-letter
  // tab with nothing saved for THIS role, draft it now (lazily — never on kit
  // open, so we don't spend a model call on a tab they may never visit).
  const [letterAutoTried, setLetterAutoTried] = useState(false);
  useEffect(() => {
    if (docTab !== "letter" || letterAutoTried) return;
    setLetterAutoTried(true);
    if (!letterText && !letterBusy && kit?.job?.jd) void generateLetter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTab]);

  // letterhead built from the answers already staged — makes the draft read as
  // a real letter (name + contact + date), not a naked block of body text
  const answerVal = (key: string) => kit?.answers.find((a) => a.key === key)?.value ?? null;
  const letterName = answerVal("fullName");
  const letterContact = [answerVal("email"), answerVal("phone"), answerVal("location")].filter(Boolean).join(" · ");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  // Edit hands the JOB to the editor: /resume?job=<id> pre-loads Target-a-job
  // with this JD + the ATS read, so editing is aimed at this role, not generic
  const editHref = `/resume?job=${opportunityId}`;

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
        {!kit && !err && <DrizzleLoader label="Staging your pack…" />}

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
                    <a className="ghost-btn" href={editHref} title="Edit aimed at THIS job — the editor opens with its keywords and ATS read loaded.">
                      ✎ Edit
                    </a>
                  )}
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
                <>
                  {/* which résumé goes out — lives on the glass, not the paper tray */}
                  <div className="applykit-resume-tools">
                    {versions.length > 0 && (
                      <span className="applykit-version-pick">
                        <select className="f-box" value={pickedVersion} onChange={(e) => setPickedVersion(e.target.value)}>
                          <option value="">Current résumé</option>
                          {versions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {(v.theme ? `${v.theme} · ` : "") + (v.label || new Date(v.createdAt).toLocaleDateString())}
                            </option>
                          ))}
                        </select>
                        {pickedVersion && (
                          <button className="ghost-btn" onClick={() => void useVersion()} disabled={versionState === "loading"}>
                            {versionState === "loading" ? "Loading…" : versionState === "done" ? "✓ Loaded" : "Use this version"}
                          </button>
                        )}
                      </span>
                    )}
                    {kit.job?.jd && ats && (
                      <button className="ghost-btn" onClick={runAts} disabled={atsBusy}>
                        {atsBusy ? "Checking…" : "↻ Re-check"}
                      </button>
                    )}
                  </div>

                  {/* diagnostics: two honest dials on the same document */}
                  <div className="applykit-diag">
                    {atsBusy && !ats && <DrizzleLoader row size={26} label="Reading this résumé the way the screening robot will…" />}
                    {ats && (
                      <div className="diag-dial">
                        <AtsRing score={simulated.size ? simScore : ats.score} />
                        <div className="diag-detail">
                          <b>
                            The robot&apos;s read — keyword screen
                            {simulated.size > 0 && <span className="diag-sim-badge">simulated · really {ats.score}%</span>}
                          </b>
                          {ats.required.filter((k) => !k.hit).length > 0 ? (
                            <span className="diag-chips">
                              {ats.required.filter((k) => !k.hit).slice(0, 6).map((k) => (
                                <button
                                  key={k.term}
                                  className={`diag-whatif${simulated.has(k.term) ? " on" : ""}`}
                                  onClick={() => toggleSim(k.term)}
                                  title="What if this were on your résumé? Pure arithmetic — nothing is added for you."
                                >
                                  {simulated.has(k.term) ? "✓" : "+"} {k.term}
                                  {!simulated.has(k.term) && deltaFor(k.term) > 0 && <em>+{deltaFor(k.term)}%</em>}
                                </button>
                              ))}
                              <a className="diag-fix" href={editHref}>✎ genuinely yours? fix in the editor</a>
                            </span>
                          ) : (
                            <span className="applykit-ats-ok">Every required keyword is covered ✓</span>
                          )}
                        </div>
                      </div>
                    )}
                    {ranked && (
                      <div className="diag-dial">
                        <AtsRing score={Math.round(ranked.fit * 100)} label="whole-person fit" />
                        <div className="diag-detail">
                          <b>drizzle&apos;s read — the whole person</b>
                          <span className="diag-chips">
                            {ranked.evidence !== null && <span className="rec-chip">résumé evidence {Math.round(ranked.evidence * 100)}%</span>}
                            {ranked.trajectory !== null && <span className="rec-chip">your direction {Math.round(ranked.trajectory * 100)}%</span>}
                            <span className="rec-chip">how you work {Math.round(ranked.desire * 100)}%</span>
                          </span>
                          {(ranked.reasons[0] || ranked.gaps[0]) && (
                            <span className="diag-why">
                              {ranked.reasons[0] && <span className="diag-plus">▲ {ranked.reasons[0]}</span>}
                              {ranked.gaps[0] && <span className="diag-minus">▼ {ranked.gaps[0]}</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="applykit-resume-scroll">
                    {/* the print page IS the document — true fidelity, zero drift.
                        embed=1 restores the page margins (puppeteer adds them for PDF) */}
                    <iframe
                      key={frameKey}
                      className="applykit-resume-frame"
                      src={`/resume/print?u=${userId}&embed=1`}
                      title="Your résumé"
                      onLoad={(e) => fitFrame(e.currentTarget)}
                      style={{ height: `${frameH}px`, marginBottom: `-${Math.round(frameH * 0.36)}px` }}
                    />
                  </div>
                </>
              ) : letterText || letterBusy ? (
                <>
                  {letterHooks.length > 0 && (
                    <div className="applykit-hooks">
                      why this letter: {letterHooks.map((h) => (
                        <span className="rec-chip" key={h}>{h}</span>
                      ))}
                    </div>
                  )}
                  <div className="applykit-letter-sheet">
                    <div className="letter-paper">
                      <div className="letter-head">
                        {letterName && <div className="letter-name">{letterName}</div>}
                        {letterContact && <div className="letter-contact">{letterContact}</div>}
                        <div className="letter-date">{today}</div>
                      </div>
                      <textarea
                        className="letter-body"
                        value={letterBusy && !letterText ? "Writing against this job's description…" : letterText}
                        onChange={(e) => setLetterText(e.target.value)}
                        readOnly={letterBusy}
                        placeholder="Your letter…"
                      />
                    </div>
                  </div>
                </>
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
