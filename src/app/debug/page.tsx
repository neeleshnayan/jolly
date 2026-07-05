"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import UserChip from "../UserChip";

type Param = { score: number; rationale: string };
type DebugData = {
  profile: { fullName?: string | null; headline?: string | null };
  insights: { dimension: string; content: string; confidence: number | null }[];
  probes: { question: string; rationale: string | null; dimension: string | null }[];
  scoring: Record<string, Param> | null;
  scoringAt?: string | null;
  scoringError?: string | null;
};

export default function DebugPage() {
  const u = useSearchParams().get("u");
  const [data, setData] = useState<DebugData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(recompute = false) {
    setLoading(true);
    setError(null);
    try {
      // session-first; ?u= still works for dev. Recompute only on demand — the
      // score is cached, so a normal visit serves the saved vector.
      const params = new URLSearchParams();
      if (u) params.set("u", u);
      if (recompute) params.set("recompute", "1");
      const qs = params.toString();
      const res = await fetch(`/api/debug/profile${qs ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u]);

  return (
    <main className="debug">
      <div className="debug-head">
        <div>
          <h1>Debug · {data?.profile?.fullName ?? u ?? "you"}</h1>
          {data?.profile?.headline && <p className="sub">{data.profile.headline}</p>}
        </div>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a className="ghost-btn" href="/dashboard">← Dashboard</a>
          <button className="ghost-btn" onClick={() => load(true)} disabled={loading}>
            {loading ? "Scoring…" : "Recompute"}
          </button>
          <UserChip />
        </span>
      </div>

      {error && <p className="status-line error">{error}</p>}
      {loading && !data && <p className="sub">Computing the scoring vector on the big model…</p>}

      {data && (
        <>
          <section>
            <h2>Scoring vector</h2>
            {data.scoringAt && (
              <p className="sub" style={{ fontSize: 12 }}>
                Cached · computed {new Date(data.scoringAt).toLocaleString()} — hit Recompute to refresh
              </p>
            )}
            {data.scoringError && <p className="status-line error">{data.scoringError}</p>}
            {data.scoring &&
              Object.entries(data.scoring).map(([k, p]) => (
                <div className="score-row" key={k}>
                  <div className="score-label">{k.replace(/_/g, " ")}</div>
                  <div className="score-bar">
                    <div className="score-fill" style={{ width: `${Math.round((p?.score ?? 0) * 100)}%` }} />
                  </div>
                  <div className="score-num">{(p?.score ?? 0).toFixed(2)}</div>
                  <div className="score-why">{p?.rationale}</div>
                </div>
              ))}
          </section>

          <section>
            <h2>Insights ({data.insights.length})</h2>
            {data.insights.length === 0 && <p className="sub">None yet — run a mentor call.</p>}
            {data.insights.map((i, idx) => (
              <div className="debug-item" key={idx}>
                <span className="tag">{i.dimension}</span>
                <span className="conf">{(i.confidence ?? 0).toFixed(2)}</span>
                <span>{i.content}</span>
              </div>
            ))}
          </section>

          <section>
            <h2>Open probes ({data.probes.length})</h2>
            {data.probes.map((p, idx) => (
              <div className="debug-item" key={idx}>
                <span className="tag">{p.dimension ?? "—"}</span>
                <div>
                  <div>{p.question}</div>
                  {p.rationale && <div className="sub" style={{ fontSize: 12 }}>{p.rationale}</div>}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
