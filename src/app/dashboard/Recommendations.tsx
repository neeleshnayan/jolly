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
  url: string | null;
  source: string | null;
  summary: string;
  coreRequirements: string[];
  fit: number;
  reasons: string[];
  gaps: string[];
  why: string;
};
const SOURCE_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", sample: "Curated JD", pasted: "Curated JD" };
const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };
function comp(min: number | null, max: number | null) {
  if (!min && !max) return null;
  const f = (n: number) => (n >= 100000 ? `${Math.round(n / 100000)}L` : `${Math.round(n / 1000)}k`);
  return `₹${f(min ?? max!)}–${f(max ?? min!)}`;
}

type Prefs = { currentComp?: number; expectedComp?: number; locations?: string[]; remote?: "remote" | "hybrid" | "onsite" | "any" };

export default function Recommendations({ userId }: { userId: string }) {
  const [matches, setMatches] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [savingPrefs, setSavingPrefs] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // no-store: the ranking is already computed fresh server-side every call
      // (live DB query), but some browsers cache identical GET URLs anyway —
      // this guarantees a refresh actually shows new data.
      const r = await fetch(`/api/opportunities/matches?u=${userId}`, { cache: "no-store" });
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
    fetch(`/api/preferences?u=${userId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPrefs(j.preferences ?? {}))
      .catch(() => {});
  }, [load, userId]);

  async function savePrefs(next: Prefs) {
    setSavingPrefs(true);
    try {
      const r = await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, preferences: next }),
      });
      const j = await r.json();
      setPrefs(j.preferences ?? next);
      await load(); // re-rank with the new refinements
    } finally {
      setSavingPrefs(false);
    }
  }

  async function seed() {
    setSeeding(true);
    try {
      await fetch("/api/opportunities/seed", { method: "POST" });
      await load();
    } finally {
      setSeeding(false);
    }
  }

  // application tracking: clicking "View & apply" opens the posting AND asks
  // for a one-tap confirm — honest data (no phantom applications from bounces),
  // zero forms. Confirmed rows feed the outcome funnel on this same dashboard.
  const [confirming, setConfirming] = useState<Record<string, "ask" | "saving" | "done">>({});
  function onApplyClick(id: string) {
    setConfirming((c) => (c[id] ? c : { ...c, [id]: "ask" }));
  }
  async function confirmApplied(j: Job) {
    setConfirming((c) => ({ ...c, [j.id]: "saving" }));
    try {
      await fetch("/api/track/application", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, company: j.company, role: j.title, opportunityId: j.id }),
      });
      setConfirming((c) => ({ ...c, [j.id]: "done" }));
    } catch {
      setConfirming((c) => ({ ...c, [j.id]: "ask" })); // let them retry
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
        {process.env.NODE_ENV !== "production" && (
          <button className="refine-toggle" onClick={() => void load()} disabled={loading} title="Debug only — force a fresh fetch, bypassing any cache">
            {loading ? "Refreshing…" : "⟳ Refresh (debug)"}
          </button>
        )}
        <button className="refine-toggle" onClick={() => setShowRefine((v) => !v)}>
          {showRefine ? "Close" : "Refine ⚙"}
        </button>
      </div>
      {showRefine && <RefinePanel prefs={prefs} saving={savingPrefs} onSave={savePrefs} />}
      <div className="rec-list">
        {top.map((j) => (
          <div className="rec-card" key={j.id}>
            <div className="rec-fit">
              <span className="rec-fit-pct">{Math.round(j.fit * 100)}</span>
              <span className="rec-fit-unit">% fit</span>
            </div>
            <div className="rec-main">
              <div className="rec-title-row">
                <div>
                  <div className="rec-title">{j.title}</div>
                  <div className="rec-co">{j.company}</div>
                </div>
                {j.source && <span className="rec-source">{SOURCE_LABEL[j.source] ?? j.source}</span>}
              </div>

              <div className="rec-facts">
                {comp(j.compMin, j.compMax) && (
                  <div className="rec-fact">
                    <span className="rec-fact-label">Comp</span>
                    <span className="rec-fact-value">{comp(j.compMin, j.compMax)}</span>
                  </div>
                )}
                {j.location && (
                  <div className="rec-fact">
                    <span className="rec-fact-label">Location</span>
                    <span className="rec-fact-value">{j.location}</span>
                  </div>
                )}
                {j.remote && REMOTE_LABEL[j.remote] && (
                  <div className="rec-fact">
                    <span className="rec-fact-label">Work style</span>
                    <span className="rec-fact-value">{REMOTE_LABEL[j.remote]}</span>
                  </div>
                )}
                {j.stage && (
                  <div className="rec-fact">
                    <span className="rec-fact-label">Stage</span>
                    <span className="rec-fact-value">{j.stage}</span>
                  </div>
                )}
              </div>

              {j.summary && <p className="rec-summary">{j.summary}</p>}

              {j.coreRequirements.length > 0 && (
                <div className="rec-reqs">
                  <div className="rec-reqs-label">What they're looking for</div>
                  <ul>
                    {j.coreRequirements.slice(0, 5).map((req, i) => (
                      <li key={i}>{req}</li>
                    ))}
                  </ul>
                </div>
              )}

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
              {j.url && (
                <div className="rec-apply-row">
                  <a className="rec-apply" href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => onApplyClick(j.id)}>
                    View &amp; apply ↗
                  </a>
                  {confirming[j.id] === "ask" && (
                    <span className="apply-confirm">
                      Did you apply?
                      <button className="tip-add" onClick={() => void confirmApplied(j)}>✓ Yes, track it</button>
                      <button className="ai-cancel" onClick={() => setConfirming((c) => ({ ...c, [j.id]: undefined as never }))}>Not yet</button>
                    </span>
                  )}
                  {confirming[j.id] === "saving" && <span className="apply-confirm">Saving…</span>}
                  {confirming[j.id] === "done" && <span className="apply-confirm done">✓ Tracked — outcomes update below</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// comp is stored in absolute ₹; the form talks in LPA (lakhs/yr) for sanity
const toL = (n?: number) => (n ? String(Math.round(n / 100000)) : "");
const fromL = (s: string) => {
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? Math.round(n * 100000) : undefined;
};

function RefinePanel({ prefs, saving, onSave }: { prefs: Prefs; saving: boolean; onSave: (p: Prefs) => void }) {
  const [current, setCurrent] = useState(toL(prefs.currentComp));
  const [expected, setExpected] = useState(toL(prefs.expectedComp));
  const [locations, setLocations] = useState((prefs.locations ?? []).join(", "));
  const [remote, setRemote] = useState<Prefs["remote"]>(prefs.remote ?? "any");

  function submit() {
    onSave({
      currentComp: fromL(current),
      expectedComp: fromL(expected),
      locations: locations.split(",").map((s) => s.trim()).filter(Boolean),
      remote,
    });
  }

  return (
    <div className="refine-panel">
      <div className="refine-grid">
        <label className="refine-field">
          <span>Current comp (₹ LPA)</span>
          <input type="number" inputMode="numeric" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="e.g. 35" />
        </label>
        <label className="refine-field">
          <span>Expected comp (₹ LPA)</span>
          <input type="number" inputMode="numeric" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="e.g. 60" />
        </label>
        <label className="refine-field">
          <span>How you want to work</span>
          <select value={remote} onChange={(e) => setRemote(e.target.value as Prefs["remote"])}>
            <option value="any">Open to anything</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </select>
        </label>
        <label className="refine-field refine-wide">
          <span>Preferred locations (comma-separated)</span>
          <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Bengaluru, Remote, New York" />
        </label>
      </div>
      <div className="refine-actions">
        <span className="refine-note">Used to re-rank on top of your work style — nothing is hidden, just ordered.</span>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save & re-rank"}
        </button>
      </div>
    </div>
  );
}
