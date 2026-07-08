"use client";

import { useState } from "react";
import Recommendations from "./Recommendations";
import Brand from "../Brand";
import UserChip from "../UserChip";

type Version = {
  id: string;
  themeId: string | null;
  label: string | null;
  hypothesis: string | null;
  createdAt: string;
};
type Theme = { id: string; name: string; versions: Version[] };
type Application = {
  id: string;
  company: string | null;
  role: string | null;
  status: string;
  notes: string | null;
  followUpAt: string | Date | null;
  appliedAt: string;
  resumeVersionId: string | null;
  themeName: string | null;
};

// The board is the JOURNEY (applied → screening → interview); what happens
// after the interview is an OUTCOME, not a column — it branches to a
// celebration (offer 🎉) or to learning what didn't work (reason → the
// Outcome graph). Outcomes render as strips below the board.
const COLUMNS = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
] as const;
const colFor = (status: string) => (COLUMNS.some((c) => c.key === status) ? status : "applied");
const isOutcome = (status: string) => status === "offer" || status === "rejected" || status === "ghosted";

// why it didn't work — one tap each, feeds application_events.result
const NO_OFFER_REASONS = [
  "No response after interview",
  "Rejected after interview",
  "Position was filled",
  "Comp didn't work out",
  "I withdrew",
] as const;

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const daysSince = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000));
const toDateInput = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const overdue = (a: Application) => !!a.followUpAt && colFor(a.status) !== "closed" && new Date(a.followUpAt).getTime() < Date.now();

export default function DashboardClient({
  userId,
  name,
  hasResume,
  themes: initialThemes,
  untagged,
  applications: initialApps,
}: {
  userId: string;
  name: string | null;
  hasResume: boolean;
  themes: Theme[];
  untagged: Version[];
  applications: Application[];
}) {
  const [apps, setApps] = useState<Application[]>(initialApps);
  const [appForm, setAppForm] = useState({ company: "", role: "", resumeVersionId: "" });
  const [appMsg, setAppMsg] = useState("");

  const allVersions = [...initialThemes.flatMap((t) => t.versions.map((v) => ({ ...v, theme: t.name }))), ...untagged.map((v) => ({ ...v, theme: null as string | null }))];
  const first = (name ?? "there").split(" ")[0];

  async function logApplication() {
    if (!appForm.company.trim() && !appForm.role.trim()) {
      setAppMsg("Add a company or role");
      return;
    }
    setAppMsg("Logging…");
    const res = await fetch("/api/track/application", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, ...appForm, resumeVersionId: appForm.resumeVersionId || undefined }),
    });
    const j = await res.json();
    if (res.ok) {
      const v = allVersions.find((x) => x.id === appForm.resumeVersionId);
      setApps((a) => [
        {
          id: j.application.id,
          company: appForm.company || null,
          role: appForm.role || null,
          status: "applied",
          notes: null,
          followUpAt: null,
          appliedAt: new Date().toISOString(),
          resumeVersionId: appForm.resumeVersionId || null,
          themeName: v?.theme ?? null,
        },
        ...a,
      ]);
      setAppForm({ company: "", role: "", resumeVersionId: "" });
      setAppMsg("");
    } else {
      setAppMsg(j.error || "Couldn't log");
    }
  }

  async function setStatus(id: string, stage: string, result?: string) {
    setApps((a) => a.map((x) => (x.id === id ? { ...x, status: stage } : x)));
    await fetch("/api/track/application", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, applicationId: id, stage, ...(result ? { result } : {}) }),
    });
  }

  // the interview branch: 🎉 or learning
  const [celebrating, setCelebrating] = useState(false);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  function gotOffer(id: string) {
    void setStatus(id, "offer");
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 2600);
  }
  function noOffer(id: string, reason: string) {
    // "no response" is a ghost, everything else a rejection — honest funnel data
    void setStatus(id, /no response/i.test(reason) ? "ghosted" : "rejected", reason);
    setReasonFor(null);
  }

  // notes / follow-up edits — optimistic, saved per field
  async function saveCard(id: string, patch: { notes?: string | null; followUpAt?: string | null }) {
    setApps((a) => a.map((x) => (x.id === id ? { ...x, ...("notes" in patch ? { notes: patch.notes ?? null } : {}), ...("followUpAt" in patch ? { followUpAt: patch.followUpAt ?? null } : {}) } : x)));
    await fetch("/api/track/application", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, applicationId: id, ...patch }),
    });
  }

  // drag & drop between columns (native HTML5 — a card is one draggable)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  function dropOn(colKey: string) {
    if (!dragId) return;
    const app = apps.find((a) => a.id === dragId);
    setDragId(null);
    setDragOver(null);
    if (!app || isOutcome(app.status) || colFor(app.status) === colKey) return;
    void setStatus(app.id, colKey);
  }
  const [followOpen, setFollowOpen] = useState<Record<string, boolean>>({});
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});

  return (
    <main className="dash">
      <header className="dash-top">
        <Brand />
        <UserChip />
      </header>

      <h1 className="dash-hello">Hi {first} 👋</h1>
      <p className="dash-sub">Everything about your search in one place.</p>

      <div className="dash-cards">
        <a className="dash-card" href="/resume">
          <div className="dash-card-title">Your résumé</div>
          <div className="dash-card-desc">{hasResume ? "Edit, restyle, and version it" : "Upload one to get started"}</div>
        </a>
        <a className="dash-card" href="/mentor">
          <div className="dash-card-title">Talk to your mentor</div>
          <div className="dash-card-desc">A short voice call to go deeper</div>
        </a>
        <a className="dash-card" href="/insights">
          <div className="dash-card-title">About you</div>
          <div className="dash-card-desc">Your profile + the mentor&apos;s diagnosis</div>
        </a>
        <a className="dash-card" href="/mentors">
          <div className="dash-card-title">Mentor Connect</div>
          <div className="dash-card-desc">People who&apos;ve already made your move</div>
        </a>
      </div>

      {/* applications first: what you're IN takes priority over what's next */}
      <section className="dash-section">
        <div className="dash-section-head">
          <h2>Applications</h2>
          <span className="dash-hint">Gmail auto-tracking coming later</span>
        </div>
        <div className="app-new">
          <input className="f-box" value={appForm.company} placeholder="Company" onChange={(e) => setAppForm((f) => ({ ...f, company: e.target.value }))} />
          <input className="f-box" value={appForm.role} placeholder="Role" onChange={(e) => setAppForm((f) => ({ ...f, role: e.target.value }))} />
          <select
            className="f-box"
            value={appForm.resumeVersionId}
            onChange={(e) => setAppForm((f) => ({ ...f, resumeVersionId: e.target.value }))}
            title="Optional — which résumé version you sent. Linking versions to outcomes is how drizzle learns which framing of you actually lands interviews."
          >
            <option value="">Résumé version sent (optional)</option>
            {allVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {(v.theme ? `${v.theme} · ` : "") + fmtDate(v.createdAt)}
              </option>
            ))}
          </select>
          <button className="ghost-btn" onClick={logApplication}>+ Log</button>
          {appMsg && <span className="dash-hint">{appMsg}</span>}
        </div>
        {apps.length === 0 ? (
          <p className="dash-empty">No applications logged yet — confirm one from a recommendation card, or log it above.</p>
        ) : (
          <>
            <div className="kanban kanban-journey">
              {COLUMNS.map((col) => {
                const cards = apps.filter((a) => !isOutcome(a.status) && colFor(a.status) === col.key);
                return (
                  <div
                    key={col.key}
                    className={`kanban-col${dragOver === col.key ? " drop-target" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(col.key);
                    }}
                    onDragLeave={() => setDragOver((v) => (v === col.key ? null : v))}
                    onDrop={() => dropOn(col.key)}
                  >
                    <div className="kanban-col-head">
                      {col.label} <span className="kanban-count">{cards.length}</span>
                    </div>
                    {cards.map((a) => (
                      <div
                        key={a.id}
                        className={`kanban-card${dragId === a.id ? " dragging" : ""}`}
                        draggable
                        onDragStart={() => setDragId(a.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOver(null);
                        }}
                      >
                        <div className="kanban-card-top">
                          <div>
                            <div className="kanban-card-co">{a.company || "—"}</div>
                            {a.role && <div className="kanban-card-role">{a.role}</div>}
                          </div>
                          <span className="kanban-card-icons">
                            <button
                              className={`kanban-icon${a.followUpAt ? " has" : ""}`}
                              onClick={() => setFollowOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                              title={a.followUpAt ? `Follow up ${fmtDate(String(a.followUpAt))}` : "Set a follow-up date"}
                            >
                              ⏰
                            </button>
                            <button
                              className={`kanban-icon${a.notes ? " has" : ""}`}
                              onClick={() => setNotesOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                              title={a.notes ? "Notes" : "Add a note"}
                            >
                              🗒
                            </button>
                          </span>
                        </div>
                        <div className="kanban-card-meta">
                          {a.themeName && <span className="kanban-chip">{a.themeName}</span>}
                          <span className="kanban-age" title={`Logged ${fmtDate(a.appliedAt)}`}>{daysSince(a.appliedAt)}d</span>
                          {a.followUpAt && !overdue(a) && <span className="kanban-follow-on">⏰ {fmtDate(String(a.followUpAt))}</span>}
                          {overdue(a) && <span className="kanban-overdue" title="Follow-up date has passed">follow up!</span>}
                        </div>
                        {followOpen[a.id] && (
                          <input
                            className="kanban-follow-input"
                            type="date"
                            value={toDateInput(a.followUpAt)}
                            onChange={(e) => void saveCard(a.id, { followUpAt: e.target.value || null })}
                          />
                        )}
                        {notesOpen[a.id] && (
                          <textarea
                            className="kanban-notes"
                            defaultValue={a.notes ?? ""}
                            placeholder="Recruiter name, next step, links…"
                            rows={3}
                            onBlur={(e) => void saveCard(a.id, { notes: e.target.value })}
                          />
                        )}
                        {col.key === "interview" &&
                          (reasonFor === a.id ? (
                            <div className="kanban-reasons">
                              <div className="kanban-reasons-label">What happened?</div>
                              {NO_OFFER_REASONS.map((r) => (
                                <button key={r} className="kanban-reason" onClick={() => noOffer(a.id, r)}>
                                  {r}
                                </button>
                              ))}
                              <button className="ai-cancel" onClick={() => setReasonFor(null)}>never mind</button>
                            </div>
                          ) : (
                            <div className="kanban-branch">
                              <button className="kanban-offer-btn" onClick={() => gotOffer(a.id)}>🎉 Got the offer</button>
                              <button className="kanban-nooffer-btn" onClick={() => setReasonFor(a.id)}>No offer</button>
                            </div>
                          ))}
                      </div>
                    ))}
                    {cards.length === 0 && <div className="kanban-empty">—</div>}
                  </div>
                );
              })}
            </div>

            {apps.some((a) => a.status === "offer") && (
              <div className="outcome-strip offers">
                <div className="outcome-strip-head">🎉 Offers</div>
                {apps.filter((a) => a.status === "offer").map((a) => (
                  <div className="outcome-card offer" key={a.id}>
                    <span className="outcome-co">{a.company || "—"}</span>
                    {a.role && <span className="outcome-role">{a.role}</span>}
                    <span className="kanban-age">{fmtDate(a.appliedAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {apps.some((a) => a.status === "rejected" || a.status === "ghosted") && (
              <div className="outcome-strip closed">
                <div className="outcome-strip-head">Didn&apos;t work out — each one teaches the ranking</div>
                {apps.filter((a) => a.status === "rejected" || a.status === "ghosted").map((a) => (
                  <div className="outcome-card" key={a.id}>
                    <span className="outcome-co">{a.company || "—"}</span>
                    {a.role && <span className="outcome-role">{a.role}</span>}
                    <span className="kanban-chip">{a.status === "ghosted" ? "no response" : "rejected"}</span>
                  </div>
                ))}
              </div>
            )}
            {celebrating && <Confetti />}
          </>
        )}
      </section>

      <Recommendations userId={userId} />
    </main>
  );
}

/** A 2.5s burst of falling pieces — an offer is a big deal, act like it. */
function Confetti() {
  const pieces = Array.from({ length: 90 }, (_, i) => i);
  const colors = ["#2563eb", "#0f766e", "#f59e0b", "#ec4899", "#22c55e", "#7aa5f8"];
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${(i * 137.5) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 12) * 0.09}s`,
            animationDuration: `${1.6 + ((i * 7) % 10) / 10}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
