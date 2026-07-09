"use client";

import { useCallback, useEffect, useState } from "react";
import { formatComp } from "@/lib/format/comp";
import { displayCompany } from "@/lib/format/company";
import ApplyKit from "./ApplyKit";
import SkillMap from "../SkillMap";

type Job = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  remote: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  stage: string | null;
  url: string | null;
  source: string | null;
  summary: string;
  coreRequirements: string[];
  skills: string[];
  fit: number;
  desire: number;
  evidence: number | null;
  trajectory: number | null;
  reasons: string[];
  gaps: string[];
  why: string;
};
type RadarEntry = { skill: string; demand: number; have: boolean; avgFit: number };
const SOURCE_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", consider: "a16z portfolio", sample: "Curated JD", pasted: "Curated JD" };
const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };

type Prefs = {
  currentComp?: number; // legacy
  acceptMin?: number;
  expectedComp?: number;
  compCurrency?: "INR" | "USD" | "GBP" | "EUR";
  locations?: string[];
  remote?: "remote" | "hybrid" | "onsite" | "any";
};

// slider scales per currency: [min, max, step] in absolute annual units
const COMP_SCALE: Record<string, [number, number, number]> = {
  INR: [400000, 20000000, 100000], // 4L … 2Cr, step 1L
  USD: [40000, 700000, 5000],
  GBP: [30000, 500000, 5000],
  EUR: [30000, 500000, 5000],
};
const compLabel = (n: number | undefined, cur: string) => {
  if (!n) return "—";
  if (cur === "INR") return n >= 10000000 ? `₹${(n / 10000000).toFixed(1)} Cr` : `₹${Math.round(n / 100000)} LPA`;
  const sym = cur === "USD" ? "$" : cur === "GBP" ? "£" : "€";
  return `${sym}${Math.round(n / 1000)}k`;
};

/** Shape the kanban needs when a tracked application is lifted up live. */
export type TrackedApplication = {
  id: string;
  company: string | null;
  role: string | null;
  status: string;
  notes: string | null;
  followUpAt: string | null;
  appliedAt: string;
  resumeVersionId: string | null;
  themeName: string | null;
};

export default function Recommendations({ userId, onTracked }: { userId: string; onTracked?: (app: TrackedApplication) => void }) {
  const [matches, setMatches] = useState<Job[] | null>(null);
  const [learning, setLearning] = useState<{ active: boolean; events: number } | null>(null);
  const [radar, setRadar] = useState<RadarEntry[]>([]);
  const [skillFilter, setSkillFilter] = useState<string | null>(null);
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
      setLearning(j.learning ?? null);
      setRadar(j.skillRadar ?? []);
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

  // bookmark any job from the wild: paste a URL → saved into the pipeline,
  // vectorized by the next inference batch, ranked like any fetched role
  const [bookmarkUrl, setBookmarkUrl] = useState("");
  const [bookmarkMsg, setBookmarkMsg] = useState("");
  const [bookmarking, setBookmarking] = useState(false);
  async function bookmark() {
    if (!bookmarkUrl.trim()) return;
    setBookmarking(true);
    setBookmarkMsg("");
    try {
      const r = await fetch("/api/opportunities/bookmark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, url: bookmarkUrl.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't save");
      setBookmarkMsg(j.already ? "Already saved ✓" : `Saved “${j.title}” ✓ — it'll be analyzed & ranked shortly`);
      setBookmarkUrl("");
    } catch (e) {
      setBookmarkMsg(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBookmarking(false);
    }
  }

  // implicit-feedback signals: fire-and-forget writes that train the future
  // per-user ranker. Never block or error the UI over telemetry.
  const signal = useCallback(
    (kind: string, ids: string | string[]) => {
      const opportunityIds = Array.isArray(ids) ? ids : [ids];
      void fetch("/api/opportunities/signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, kind, opportunityIds }),
      }).catch(() => {});
    },
    [userId],
  );
  // one impression batch per set of visible cards (not per render)
  const impressionsSent = useState(() => new Set<string>())[0];
  useEffect(() => {
    const top5 = (matches ?? []).slice(0, 5).map((j) => j.id).filter((id) => !impressionsSent.has(id));
    if (!top5.length) return;
    top5.forEach((id) => impressionsSent.add(id));
    signal("impression", top5);
  }, [matches, signal, impressionsSent]);

  // "Not for me": drops the card immediately AND permanently removes the role
  // from this user's ranking (strongest negative signal we can collect)
  function dismiss(id: string) {
    setMatches((m) => (m ? m.filter((j) => j.id !== id) : m));
    signal("dismiss", id);
  }

  // application tracking: clicking "View & apply" opens the posting AND asks
  // for a one-tap confirm — honest data (no phantom applications from bounces),
  // zero forms. Confirmed rows feed the outcome funnel on this same dashboard.
  const [confirming, setConfirming] = useState<Record<string, "ask" | "saving" | "done">>({});
  // the Apply Kit rides the same click that opens the ATS tab; the ranked job
  // travels with it so the kit's diagnostics don't re-rank anything
  const [kitFor, setKitFor] = useState<{ id: string; title: string; job?: Job } | null>(null);
  // deep link from the résumé editor's redesign handoff: /dashboard?applykit=<id>
  // opens the kit for that role with the freshly tailored documents
  useEffect(() => {
    if (!matches?.length) return;
    const id = new URLSearchParams(window.location.search).get("applykit");
    if (!id) return;
    const m = matches.find((j) => j.id === id);
    if (m) setKitFor({ id: m.id, title: m.title ?? "this role", job: m });
    const url = new URL(window.location.href);
    url.searchParams.delete("applykit"); // one-shot: a reload shouldn't re-open it
    window.history.replaceState({}, "", url);
  }, [matches]);
  function onApplyClick(id: string, title?: string | null) {
    signal("apply_click", id);
    setKitFor({ id, title: title ?? "this role", job: matches?.find((j) => j.id === id) });
    setConfirming((c) => (c[id] ? c : { ...c, [id]: "ask" }));
  }
  async function confirmApplied(j: Job) {
    setConfirming((c) => ({ ...c, [j.id]: "saving" }));
    try {
      const res = await fetch("/api/track/application", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, company: j.company, role: j.title, opportunityId: j.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      signal("applied", j.id);
      setConfirming((c) => ({ ...c, [j.id]: "done" }));
      // lift the new application to the kanban so it appears WITHOUT a reload
      onTracked?.({
        id: json.application.id,
        company: displayCompany(j.company),
        role: j.title,
        status: "applied",
        notes: null,
        followUpAt: null,
        appliedAt: new Date().toISOString(),
        resumeVersionId: null,
        themeName: null,
      });
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

  const filtered = skillFilter ? matches.filter((m) => m.skills?.some((s) => s === skillFilter || s.includes(skillFilter) || skillFilter.includes(s))) : matches;
  const top = filtered.slice(0, skillFilter ? 8 : 5);
  const activeRadar = skillFilter ? radar.find((r) => r.skill === skillFilter) : null;

  return (
    <section className="dash-section">
      <div className="dash-section-head">
        <h2>Recommended for you</h2>
        <span className="dash-hint">
          Ranked to how you work, not just what you can do
          {learning?.active && (
            <span title="Your applies and dismissals tune this ranking — it sharpens with every choice."> · learning from your choices ✓</span>
          )}
        </span>
        <button
          className="refine-toggle"
          onClick={() => void load()}
          disabled={loading}
          title="Re-rank now — pulls in roles vectorized since this page loaded (your bookmarks show up here once analyzed)"
        >
          {loading ? "Refreshing…" : "⟳ Refresh"}
        </button>
        <button className="refine-toggle" onClick={() => setShowRefine((v) => !v)}>
          {showRefine ? "Close" : "Refine ⚙"}
        </button>
      </div>
      {/* reading order: what the market wants (skill gap) → your knobs (refine) → the jobs */}
      <SkillMap radar={radar} mode="filter" selected={skillFilter} onSelect={setSkillFilter} />
      {showRefine && <RefinePanel prefs={prefs} saving={savingPrefs} onSave={savePrefs} />}
      {skillFilter && (
        <div className="skill-callout">
          {activeRadar && !activeRadar.have ? (
            <>
              <b>{activeRadar.demand} roles aligned with you ask for {skillFilter}</b> — it&apos;s not on your résumé yet. If you have it,
              add it (it changes your ATS hits too); if you don&apos;t, that&apos;s a conversation worth having with your mentor.
            </>
          ) : (
            <>
              Showing roles asking for <b>{skillFilter}</b> — a strength of yours worth leading with.
            </>
          )}
          <button className="ai-cancel" onClick={() => setSkillFilter(null)}>clear filter</button>
        </div>
      )}
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
                  <div className="rec-co">{displayCompany(j.company)}</div>
                </div>
                <span className="rec-title-side">
                  {j.source && <span className="rec-source">{SOURCE_LABEL[j.source] ?? j.source}</span>}
                  <button className="rec-dismiss" onClick={() => dismiss(j.id)} title="Not for me — never rank this role for me again (and teach the ranking what to avoid)">
                    ✕
                  </button>
                </span>
              </div>

              <div className="rec-facts">
                {formatComp(j.compMin, j.compMax, j.location, j.compCurrency) && (
                  <div className="rec-fact">
                    <span className="rec-fact-label">Comp</span>
                    <span className="rec-fact-value">{formatComp(j.compMin, j.compMax, j.location, j.compCurrency)}</span>
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
                  <a className="rec-apply" href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => onApplyClick(j.id, j.title)}>
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
                  {confirming[j.id] === "done" && (
                    <span className="apply-confirm done">
                      ✓ Tracked — follow it on <a href="/insights">About you</a>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* the escape hatch closes the section: seen everything and still have a
          role from elsewhere? bring it into the pipeline */}
      <div className="bookmark-row">
        <input
          className="f-box bookmark-input"
          value={bookmarkUrl}
          placeholder="Found a job elsewhere? Paste its URL to rank it against you…"
          onChange={(e) => setBookmarkUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void bookmark()}
        />
        <button className="refine-toggle" onClick={() => void bookmark()} disabled={bookmarking || !bookmarkUrl.trim()}>
          {bookmarking ? "Saving…" : "+ Save job"}
        </button>
        {bookmarkMsg && <span className="dash-hint">{bookmarkMsg}</span>}
      </div>
      {kitFor && (
        <ApplyKit
          userId={userId}
          opportunityId={kitFor.id}
          jobTitle={kitFor.title}
          ranked={
            kitFor.job
              ? { fit: kitFor.job.fit, desire: kitFor.job.desire, evidence: kitFor.job.evidence, trajectory: kitFor.job.trajectory, reasons: kitFor.job.reasons, gaps: kitFor.job.gaps }
              : null
          }
          onClose={() => setKitFor(null)}
        />
      )}
    </section>
  );
}

function RefinePanel({ prefs, saving, onSave }: { prefs: Prefs; saving: boolean; onSave: (p: Prefs) => void }) {
  const [currency, setCurrency] = useState<NonNullable<Prefs["compCurrency"]>>(prefs.compCurrency ?? "INR");
  const [floor, setFloor] = useState<number | undefined>(prefs.acceptMin ?? prefs.currentComp);
  const [expected, setExpected] = useState<number | undefined>(prefs.expectedComp);
  const [locations, setLocations] = useState((prefs.locations ?? []).join(", "));
  const [remote, setRemote] = useState<Prefs["remote"]>(prefs.remote ?? "any");
  const [min, max, step] = COMP_SCALE[currency];

  function pickCurrency(cur: NonNullable<Prefs["compCurrency"]>) {
    // numbers don't survive a currency switch — ₹60L is not $60k
    setCurrency(cur);
    setFloor(undefined);
    setExpected(undefined);
  }

  function submit() {
    onSave({
      acceptMin: floor,
      expectedComp: expected,
      compCurrency: currency,
      locations: locations.split(",").map((s) => s.trim()).filter(Boolean),
      remote,
    });
  }

  const lo = floor ?? min;
  const hi = expected ?? Math.min(max, min + (max - min) * 0.4);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className="refine-panel">
      <div className="refine-grid">
        <label className="refine-field">
          <span>Currency</span>
          <select value={currency} onChange={(e) => pickCurrency(e.target.value as NonNullable<Prefs["compCurrency"]>)}>
            <option value="INR">₹ INR</option>
            <option value="USD">$ USD</option>
            <option value="GBP">£ GBP</option>
            <option value="EUR">€ EUR</option>
          </select>
        </label>
        <div className="refine-field refine-wide refine-comp">
          <span>
            Comp range — would accept from <b>{compLabel(lo, currency)}</b>, aiming for <b>{compLabel(hi, currency)}</b>
          </span>
          <div className="range-dual">
            <div className="range-track">
              <i style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }} />
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={lo}
              aria-label="Floor you would accept"
              onChange={(e) => setFloor(Math.min(Number(e.target.value), hi))}
            />
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={hi}
              aria-label="Target compensation"
              onChange={(e) => setExpected(Math.max(Number(e.target.value), lo))}
            />
          </div>
          <span className="range-hint">Roles at your target rank clean · inside the range barely dip · below the floor sink hard.</span>
        </div>
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
        <span className="refine-note">Used to re-rank on top of your work style — nothing is hidden, just ordered. Cross-currency roles compare via rough FX.</span>
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save & re-rank"}
        </button>
      </div>
    </div>
  );
}
