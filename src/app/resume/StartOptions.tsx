"use client";

import { useEffect, useState } from "react";

type Version = { id: string; hypothesis: string | null; createdAt: string };
type Theme = { id: string; name: string; versions: Version[] };

/**
 * The two ways to start a résumé from scratch: a blank canvas, or fork an
 * existing saved version as a starting point. Shown alongside the file upload.
 */
export default function StartOptions({ userId }: { userId: string }) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [untagged, setUntagged] = useState<Version[]>([]);
  const [forkId, setForkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/track/version?u=${userId}`)
      .then((r) => r.json())
      .then((j) => {
        setThemes(j.themes ?? []);
        setUntagged(j.untagged ?? []);
      })
      .catch(() => {});
  }, [userId]);

  const options = [
    ...themes.flatMap((t) => t.versions.map((v) => ({ ...v, theme: t.name as string | null }))),
    ...untagged.map((v) => ({ ...v, theme: null as string | null })),
  ];

  async function fork() {
    if (!forkId) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/track/version/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, versionId: forkId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Fork failed");
      window.location.href = "/resume"; // now populated with the forked content
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fork failed");
      setBusy(false);
    }
  }

  return (
    <div className="start-options">
      <div className="start-or">or start from scratch</div>
      <div className="start-row">
        <a className="start-tile" href="/resume?scratch=1">
          <div className="start-tile-title">Blank canvas</div>
          <div className="start-tile-desc">Build a fresh résumé section by section</div>
        </a>
        {options.length > 0 && (
          <div className="start-tile as-form">
            <div className="start-tile-title">Fork a version</div>
            <select className="f-box" value={forkId} onChange={(e) => setForkId(e.target.value)}>
              <option value="">Pick a version…</option>
              {options.map((v) => (
                <option key={v.id} value={v.id}>
                  {(v.theme ? `${v.theme} · ` : "") +
                    new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </option>
              ))}
            </select>
            <button className="ghost-btn" onClick={fork} disabled={!forkId || busy}>
              {busy ? "Forking…" : "Fork it →"}
            </button>
          </div>
        )}
      </div>
      {err && <div className="status-line error">{err}</div>}
    </div>
  );
}
