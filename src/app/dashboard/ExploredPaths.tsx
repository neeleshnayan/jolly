"use client";

/**
 * C — the exploration memory, made visible. Every path a user tried on (via a
 * mentor card dive) is a saved branch; here they compare them side by side and
 * COMMIT to one. Exploring is free (the funnel); "commit" is the paid step-up
 * (brokered intro + apply kit) — the pricing gate. Renders nothing until there's
 * at least one branch, so first-timers see no clutter.
 */
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api-fetch";
import { displayCompany } from "@/lib/format/company";

type Path = {
  id: string;
  label: string;
  company: string | null;
  kind: string | null;
  summary: Record<string, unknown> | null;
  visitCount: number;
  committedAt: string | null;
  lastVisitedAt: string;
};

function ago(iso: string): string {
  const d = Math.max(0, Date.now() - Date.parse(iso));
  const day = 86400000;
  if (d < 3600000) return "just now";
  if (d < day) return `${Math.round(d / 3600000)}h ago`;
  if (d < 7 * day) return `${Math.round(d / day)}d ago`;
  return `${Math.round(d / (7 * day))}w ago`;
}

export default function ExploredPaths({ userId }: { userId: string }) {
  const [paths, setPaths] = useState<Path[] | null>(null);
  const [committing, setCommitting] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/mentor/explored", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPaths(j.paths ?? []))
      .catch(() => setPaths([]));
  }, [userId]);

  async function commit(id: string) {
    setCommitting(id);
    try {
      const r = await fetch("/api/mentor/explored", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await r.json().catch(() => ({}));
      setPaths((ps) => ps?.map((p) => (p.id === id ? { ...p, committedAt: new Date().toISOString() } : p)) ?? ps);
      // committing set this path as the target direction → send them up to the
      // recommendations, which re-rank toward it (the ?retuning banner + refetch)
      if (j?.retuned) {
        window.location.assign("/dashboard?retuning=1#recommendations");
        return;
      }
    } catch {
      /* leave the button; they can retry */
    } finally {
      setCommitting(null);
    }
  }

  if (!paths || paths.length === 0) return null; // invisible for first-timers

  return (
    <section className="dash-section">
      <div className="dash-section-head">
        <h2>Paths you&apos;ve explored</h2>
        <span className="dash-hint">Every direction you&apos;ve tried on — compare, or commit to one</span>
      </div>
      <div className="explored-grid">
        {paths.map((p) => {
          const why = typeof p.summary?.why === "string" ? (p.summary.why as string) : "";
          const committed = !!p.committedAt;
          return (
            <div className={`explored-card${committed ? " committed" : ""}`} key={p.id}>
              {p.kind && <span className="explored-kind">{p.kind}</span>}
              <div className="explored-label">{p.label}</div>
              {p.company && <div className="explored-co">{displayCompany(p.company)}</div>}
              {why && <div className="explored-why">{why}</div>}
              <div className="explored-meta">
                explored {p.visitCount}×{p.visitCount > 1 ? "" : ""} · {ago(p.lastVisitedAt)}
              </div>
              {committed ? (
                <div className="explored-committed">✓ Committed — we&apos;ll line up your intro + apply kit</div>
              ) : (
                <button className="explored-commit" onClick={() => commit(p.id)} disabled={committing === p.id}>
                  {committing === p.id ? "…" : "Commit to this path →"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
