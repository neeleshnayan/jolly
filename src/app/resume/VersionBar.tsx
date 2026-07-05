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

  async function useForApplications() {
    if (!versionId || !currentTheme) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/track/theme/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, themeId: currentTheme.id, versionId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      setThemes((ts) => ts.map((t) => (t.id === currentTheme.id ? { ...t, activeVersionId: versionId } : t)));
      setMsg("Set as active ✓");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const hasThemes = themes.length > 0 || untagged.length > 0;

  return (
    <div className="version-bar no-print">
      <span className="vb-label">Version</span>
      <select className="vb-select" value={themeId} onChange={(e) => pickTheme(e.target.value)}>
        <option value="">{hasThemes ? "— theme —" : "No versions yet"}</option>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
        {untagged.length > 0 && <option value="__untagged">Untagged</option>}
      </select>

      {versions.length > 0 && (
        <select
          className="vb-select wide"
          value={versionId}
          onChange={(e) => void pickVersion(e.target.value)}
          disabled={busy}
          title="Pick a version to load it into the editor"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {(v.id === activeId ? "★ " : "") + fmt(v)}
            </option>
          ))}
        </select>
      )}

      {versionId && currentTheme && (
        <button
          className={`vb-btn${versionId === activeId ? " on" : ""}`}
          onClick={useForApplications}
          disabled={busy}
          title="Use this version when applying under this theme"
        >
          {versionId === activeId ? "★ Active for applications" : "Set active for applications"}
        </button>
      )}

      <button className="vb-btn primary" onClick={onSaveVersion} title="Snapshot the current résumé as a new version">
        + Save as new version
      </button>
      {msg && <span className="vb-msg">{msg}</span>}
    </div>
  );
}
