"use client";

import { useState } from "react";
import Recommendations from "./Recommendations";
import Brand from "../Brand";

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

// kanban columns; rejected & ghosted share "Closed" (they're both endings —
// the distinction lives on the card, not in board real estate)
const COLUMNS = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "closed", label: "Closed" },
] as const;
const colFor = (status: string) => (status === "rejected" || status === "ghosted" ? "closed" : COLUMNS.some((c) => c.key === status) ? status : "applied");

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const daysSince = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000));
const toDateInput = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const overdue = (a: Application) => !!a.followUpAt && colFor(a.status) !== "closed" && new Date(a.followUpAt).getTime() < Date.now();

export default function DashboardClient({
  userId,
  name,
  avatarUrl,
  hasResume,
  themes: initialThemes,
  untagged,
  applications: initialApps,
}: {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  hasResume: boolean;
  themes: Theme[];
  untagged: Version[];
  applications: Application[];
}) {
  const [themes] = useState<Theme[]>(initialThemes);
  const [newTheme, setNewTheme] = useState("");
  const [themeMsg, setThemeMsg] = useState("");
  const [apps, setApps] = useState<Application[]>(initialApps);
  const [appForm, setAppForm] = useState({ company: "", role: "", resumeVersionId: "" });
  const [appMsg, setAppMsg] = useState("");

  const allVersions = [...themes.flatMap((t) => t.versions.map((v) => ({ ...v, theme: t.name }))), ...untagged.map((v) => ({ ...v, theme: null as string | null }))];
  const first = (name ?? "there").split(" ")[0];

  async function addTheme() {
    if (!newTheme.trim()) return;
    setThemeMsg("Adding…");
    const res = await fetch("/api/track/theme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, name: newTheme.trim() }),
    });
    if (res.ok) {
      setThemeMsg("Added ✓ — reload to see it");
      setNewTheme("");
    } else {
      setThemeMsg("Couldn't add theme");
    }
  }

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

  async function setStatus(id: string, stage: string) {
    setApps((a) => a.map((x) => (x.id === id ? { ...x, status: stage } : x)));
    await fetch("/api/track/application", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, applicationId: id, stage }),
    });
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
    if (!app || colFor(app.status) === colKey) return;
    // landing in Closed defaults to "rejected"; the card's toggle flips it to ghosted
    void setStatus(app.id, colKey === "closed" ? "rejected" : colKey);
  }
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});

  return (
    <main className="dash">
      <header className="dash-top">
        <Brand />
        <span className="dash-user">
          {avatarUrl && <img className="dash-avatar" src={avatarUrl} alt="" />}
          <span>{name ?? "You"}</span>
          <a className="ghost-btn" href="/api/auth/logout">Sign out</a>
        </span>
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

      <Recommendations userId={userId} />

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>Themes &amp; versions</h2>
          <span className="dash-hint">Save versions from the résumé editor</span>
        </div>
        <div className="theme-new">
          <input
            className="f-box"
            value={newTheme}
            placeholder="New theme — e.g. Quant, Founder, PM, AI"
            onChange={(e) => setNewTheme(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTheme()}
          />
          <button className="ghost-btn" onClick={addTheme}>+ Add theme</button>
          {themeMsg && <span className="dash-hint">{themeMsg}</span>}
        </div>
        {themes.length === 0 && untagged.length === 0 ? (
          <p className="dash-empty">No versions yet. Open your résumé, tune it for an angle, and hit “Save version”.</p>
        ) : (
          <div className="theme-grid">
            {themes.map((t) => (
              <div className="theme-card" key={t.id}>
                <div className="theme-name">{t.name}</div>
                {t.versions.length === 0 ? (
                  <div className="dash-empty small">No versions saved under this theme yet.</div>
                ) : (
                  t.versions.map((v) => (
                    <div className="ver-row" key={v.id}>
                      <span className="ver-date">{fmtDate(v.createdAt)}</span>
                      <span className="ver-hyp">{v.hypothesis || v.label || "Snapshot"}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
            {untagged.length > 0 && (
              <div className="theme-card">
                <div className="theme-name muted">Untagged</div>
                {untagged.map((v) => (
                  <div className="ver-row" key={v.id}>
                    <span className="ver-date">{fmtDate(v.createdAt)}</span>
                    <span className="ver-hyp">{v.hypothesis || v.label || "Snapshot"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>Applications</h2>
          <span className="dash-hint">Gmail auto-tracking coming later</span>
        </div>
        <div className="app-new">
          <input className="f-box" value={appForm.company} placeholder="Company" onChange={(e) => setAppForm((f) => ({ ...f, company: e.target.value }))} />
          <input className="f-box" value={appForm.role} placeholder="Role" onChange={(e) => setAppForm((f) => ({ ...f, role: e.target.value }))} />
          <select className="f-box" value={appForm.resumeVersionId} onChange={(e) => setAppForm((f) => ({ ...f, resumeVersionId: e.target.value }))}>
            <option value="">Which version?</option>
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
          <div className="kanban">
            {COLUMNS.map((col) => {
              const cards = apps.filter((a) => colFor(a.status) === col.key);
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
                      <div className="kanban-card-co">{a.company || "—"}</div>
                      {a.role && <div className="kanban-card-role">{a.role}</div>}
                      <div className="kanban-card-meta">
                        {a.themeName && <span className="kanban-chip">{a.themeName}</span>}
                        <span className="kanban-age" title={`Logged ${fmtDate(a.appliedAt)}`}>{daysSince(a.appliedAt)}d</span>
                        {overdue(a) && <span className="kanban-overdue" title="Follow-up date has passed">follow up!</span>}
                      </div>
                      {col.key === "closed" && (
                        <div className="kanban-closed-kind">
                          {(["rejected", "ghosted"] as const).map((s) => (
                            <button key={s} className={`kanban-kind${a.status === s ? " on" : ""}`} onClick={() => void setStatus(a.id, s)}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="kanban-card-actions">
                        <label className="kanban-follow" title="Follow-up date — the card flags itself when this passes">
                          ⏰
                          <input
                            type="date"
                            value={toDateInput(a.followUpAt)}
                            onChange={(e) => void saveCard(a.id, { followUpAt: e.target.value || null })}
                          />
                        </label>
                        <button
                          className={`kanban-notes-toggle${a.notes ? " has" : ""}`}
                          onClick={() => setNotesOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                          title={a.notes ? "Notes" : "Add a note"}
                        >
                          🗒
                        </button>
                      </div>
                      {notesOpen[a.id] && (
                        <textarea
                          className="kanban-notes"
                          defaultValue={a.notes ?? ""}
                          placeholder="Recruiter name, next step, links…"
                          rows={3}
                          onBlur={(e) => void saveCard(a.id, { notes: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                  {cards.length === 0 && <div className="kanban-empty">—</div>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
