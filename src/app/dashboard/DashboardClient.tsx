"use client";

import { useState } from "react";
import Recommendations from "./Recommendations";

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
  appliedAt: string;
  resumeVersionId: string | null;
  themeName: string | null;
};

const STAGES = ["applied", "screening", "interview", "offer", "rejected", "ghosted"];

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

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

  return (
    <main className="dash">
      <header className="dash-top">
        <span className="brand">drizzle</span>
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
        <a className="dash-card" href="/debug">
          <div className="dash-card-title">Mentor&apos;s understanding</div>
          <div className="dash-card-desc">Your scores &amp; what it&apos;s learned</div>
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
          <p className="dash-empty">No applications logged yet.</p>
        ) : (
          <table className="app-table">
            <thead>
              <tr><th>Company</th><th>Role</th><th>Version</th><th>Stage</th></tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>{a.company || "—"}</td>
                  <td>{a.role || "—"}</td>
                  <td>{a.themeName || (a.resumeVersionId ? "Snapshot" : "—")}</td>
                  <td>
                    <select className={`stage stage-${a.status}`} value={a.status} onChange={(e) => setStatus(a.id, e.target.value)}>
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
