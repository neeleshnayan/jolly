"use client";

import { useCallback, useEffect, useState } from "react";

type Job = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  remote: string | null;
  compMin: number | null;
  compMax: number | null;
  stage: string | null;
  fit: number;
  reasons: string[];
  gaps: string[];
  why: string;
};
function comp(min: number | null, max: number | null) {
  if (!min && !max) return null;
  const f = (n: number) => (n >= 100000 ? `${Math.round(n / 100000)}L` : `${Math.round(n / 1000)}k`);
  return `₹${f(min ?? max!)}–${f(max ?? min!)}`;
}

export default function Recommendations({ userId }: { userId: string }) {
  const [matches, setMatches] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/opportunities/matches?u=${userId}`);
      const j = await r.json();
      setMatches(j.matches ?? []);
    } catch {
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function seed() {
    setSeeding(true);
    try {
      await fetch("/api/opportunities/seed", { method: "POST" });
      await load();
    } finally {
      setSeeding(false);
    }
  }

  if (loading && !matches) {
    return (
      <section className="dash-section">
        <div className="dash-section-head"><h2>Recommended for you</h2></div>
        <p className="dash-empty">Finding roles that fit…</p>
      </section>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <section className="dash-section">
        <div className="dash-section-head"><h2>Recommended for you</h2></div>
        <p className="dash-empty">No roles to match against yet.</p>
        <button className="btn-primary" onClick={seed} disabled={seeding} style={{ marginTop: 8 }}>
          {seeding ? "Loading…" : "Load a sample of roles"}
        </button>
      </section>
    );
  }

  const top = matches.slice(0, 5);

  return (
    <section className="dash-section">
      <div className="dash-section-head">
        <h2>Recommended for you</h2>
        <span className="dash-hint">Ranked to how you work, not just what you can do</span>
      </div>
      <div className="rec-list">
        {top.map((j) => (
          <div className="rec-card" key={j.id}>
            <div className="rec-fit">
              <span className="rec-fit-pct">{Math.round(j.fit * 100)}</span>
              <span className="rec-fit-unit">% fit</span>
            </div>
            <div className="rec-main">
              <div className="rec-title-row">
                <span className="rec-title">{j.title}</span>
                <span className="rec-co">{j.company}</span>
              </div>
              <div className="rec-meta">
                {[j.location, comp(j.compMin, j.compMax), j.stage].filter(Boolean).join(" · ")}
              </div>
              <div className="rec-why">{j.why}</div>
              {(j.reasons.length > 0 || j.gaps.length > 0) && (
                <div className="rec-chips">
                  {j.reasons.slice(0, 3).map((r, i) => (
                    <span className="rec-chip good" key={`r${i}`}>{r}</span>
                  ))}
                  {j.gaps.slice(0, 1).map((g, i) => (
                    <span className="rec-chip gap" key={`g${i}`}>{g}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
