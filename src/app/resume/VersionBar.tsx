"use client";

import { useCallback, useEffect, useState } from "react";

type Version = {
  id: string;
  themeId: string | null;
  label: string | null;
  hypothesis: string | null;
  createdAt: string;
};
type Theme = { id: string; name: string; activeVersionId: string | null; versions: Version[] };

function fmt(v: Version) {
  const d = new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const label = v.hypothesis || v.label || "Snapshot";
  return `${d} · ${label.length > 40 ? label.slice(0, 40) + "…" : label}`;
}

/**
 * Themes + versions selector that sits on top of the editor. Pick a theme, pick
 * which version is active for applications (not always the latest), and load any
 * version back into the editor. Forking = load a version, edit, Save as new.
 */
export default function VersionBar({
  userId,
  refreshKey,
  onSaveVersion,
  onAfterRestore,
}: {
  userId: string;
  refreshKey: number;
  onSaveVersion: () => void;
  onAfterRestore: () => void | Promise<void>;
}) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [untagged, setUntagged] = useState<Version[]>([]);
  const [themeId, setThemeId] = useState<string>("");
  const [versionId, setVersionId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newThemeOpen, setNewThemeOpen] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");

  async function createTheme() {
    const name = newThemeName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await fetch("/api/track/theme", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, name }),
      });
      const j = await r.json();
      if (r.ok && j.theme?.id) {
        setThemes((ts) => [...ts, { id: j.theme.id, name, activeVersionId: null, versions: [] }]);
        setThemeId(j.theme.id);
        setNewThemeOpen(false);
        setNewThemeName("");
        setMsg(`Theme "${name}" ready — save a version under it`);
      }
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/track/version?u=${userId}`);
      const j = await r.json();
      if (!r.ok) return;
      setThemes(j.themes ?? []);
      setUntagged(j.untagged ?? []);
    } catch {
      /* non-fatal */
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const currentTheme = themes.find((t) => t.id === themeId);
  const versions = themeId === "__untagged" ? untagged : currentTheme?.versions ?? [];
  const activeId = currentTheme?.activeVersionId ?? null;

  // switching theme just repopulates the version list (defaults to the active
  // one); it does NOT load — loading happens when you pick a version
  function pickTheme(id: string) {
    setThemeId(id);
    setMsg("");
    const t = themes.find((x) => x.id === id);
    const vs = id === "__untagged" ? untagged : t?.versions ?? [];
    setVersionId(t?.activeVersionId ?? vs[0]?.id ?? "");
  }

  // picking a version loads it straight into the editor (no separate Load button)
  async function pickVersion(id: string) {
    setVersionId(id);
    if (!id) return;
    setBusy(true);
    setMsg("Loading…");
    try {
      const r = await fetch("/api/track/version/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, versionId: id }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Restore failed");
      await onAfterRestore();
      setMsg("Loaded ✓");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function setActiveVersion(id: string) {
    if (!currentTheme) return; // untagged versions have no theme to mark active
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/track/theme/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, themeId: currentTheme.id, versionId: id }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      setThemes((ts) => ts.map((t) => (t.id === currentTheme.id ? { ...t, activeVersionId: id } : t)));
      setMsg("Active set ✓");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const hasThemes = themes.length > 0 || untagged.length > 0;

  return (
    <div className="version-bar no-print">
      <span className="vb-label">Résumé theme</span>
      <select className="vb-select" value={themeId} onChange={(e) => pickTheme(e.target.value)}>
        <option value="">{hasThemes ? "— pick a theme —" : "No themes yet"}</option>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
        {untagged.length > 0 && <option value="__untagged">Untagged</option>}
      </select>
      {newThemeOpen ? (
        <span className="vb-newtheme">
          <input
            className="vb-select"
            value={newThemeName}
            placeholder="Quant, Founder, PM…"
            autoFocus
            onChange={(e) => setNewThemeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createTheme();
              if (e.key === "Escape") setNewThemeOpen(false);
            }}
          />
          <button className="vb-btn" onClick={() => void createTheme()} disabled={busy || !newThemeName.trim()}>✓</button>
          <button className="vb-btn" onClick={() => setNewThemeOpen(false)}>✕</button>
        </span>
      ) : (
        <button className="vb-btn" onClick={() => setNewThemeOpen(true)} title="A theme is a strategic angle — one résumé direction you're testing">
          + theme
        </button>
      )}

      {versions.length > 0 && (
        <>
          <span className="vb-sep">›</span>
          <div className="vb-chips">
            {versions.map((v) => (
              <span
                key={v.id}
                className={`vb-chip${v.id === versionId ? " current" : ""}${v.id === activeId ? " active" : ""}`}
              >
                <button
                  className="vb-chip-load"
                  onClick={() => void pickVersion(v.id)}
                  disabled={busy}
                  title="Load this version into the editor"
                >
                  {fmt(v)}
                </button>
                {currentTheme && (
                  <button
                    className="vb-chip-star"
                    onClick={() => void setActiveVersion(v.id)}
                    disabled={busy}
                    title={v.id === activeId ? "Active for applications" : "Set active for applications"}
                  >
                    {v.id === activeId ? "★" : "☆"}
                  </button>
                )}
              </span>
            ))}
          </div>
        </>
      )}

      <button className="vb-btn primary" onClick={onSaveVersion} title="Snapshot the current résumé as a new version">
        + Save as new version
      </button>
      {msg && <span className="vb-msg">{msg}</span>}
    </div>
  );
}
