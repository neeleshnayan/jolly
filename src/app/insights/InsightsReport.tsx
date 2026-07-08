"use client";

import { useCallback, useEffect, useState } from "react";
import UserChip from "../UserChip";
import { displayCompany } from "@/lib/format/company";

type Param = { score: number; rationale: string };
type Fact<T> = { value: T | null; pinned: boolean };
type About = {
  currentEmployer: Fact<string>;
  yearsExperience: Fact<number>;
  highestDegree: Fact<string>;
  trajectory: Fact<string>;
};
type Report = {
  profile: { fullName: string | null; headline: string | null };
  about: About | null;
  scoring: Record<string, Param> | null;
  scoringAt: string | null;
  insights: { dimension: string; content: string; confidence: number | null }[];
  probes: { question: string; rationale: string | null; dimension: string | null }[];
  targetRole: { role: string; rationale: string } | null;
  topMatches: { title: string | null; company: string | null; fit: number; url: string | null }[];
};
type ExecRead = { readline: string; narrative: string[]; moves: string[] };

// the vector, organized the way the matcher actually uses it
const AXIS_GROUPS: { title: string; blurb: string; axes: { key: string; label: string; low: string; high: string }[] }[] = [
  {
    title: "Capability",
    blurb: "What the résumé evidences you can do",
    axes: [
      { key: "seniority", label: "Seniority", low: "early career", high: "executive" },
      { key: "leadership_inclination", label: "Leadership", low: "IC", high: "leads teams" },
      { key: "technical_depth", label: "Technical depth", low: "generalist", high: "deep specialist" },
      { key: "breadth", label: "Breadth", low: "single domain", high: "polymath" },
    ],
  },
  {
    title: "Drives",
    blurb: "What actually pulls you — the ranking signal",
    axes: [
      { key: "builder_energy", label: "Building", low: "operate & optimize", high: "build from zero" },
      { key: "people_energy", label: "People leadership", low: "own craft", high: "grow people" },
      { key: "autonomy_need", label: "Autonomy", low: "clear direction", high: "own the show" },
      { key: "impact_drive", label: "Impact", low: "steady contribution", high: "move the needle" },
      { key: "risk_tolerance", label: "Risk appetite", low: "stability", high: "bet on upside" },
      { key: "growth_vs_stability", label: "Growth hunger", low: "consolidate", high: "stretch hard" },
      { key: "comp_priority", label: "Comp priority", low: "mission first", high: "comp matters" },
      { key: "pivot_appetite", label: "Pivot appetite", low: "deepen domain", high: "jump domains" },
    ],
  },
];

const DIM_META: Record<string, { icon: string; label: string }> = {
  energizer: { icon: "⚡", label: "Energizes you" },
  drainer: { icon: "🪫", label: "Drains you" },
  value: { icon: "🧭", label: "What matters" },
  aspiration: { icon: "🌅", label: "Who you're becoming" },
  goal: { icon: "🎯", label: "Near-term goals" },
  blocker: { icon: "🧱", label: "In the way" },
  pattern: { icon: "🔁", label: "Recurring patterns" },
  constraint: { icon: "⚓", label: "Constraints" },
};

export default function InsightsReport({ userId }: { userId: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [exec, setExec] = useState<ExecRead | null>(null);
  const [execBusy, setExecBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/insights/report?u=${userId}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setR(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load your report");
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function generateExec() {
    setExecBusy(true);
    try {
      const res = await fetch("/api/insights/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId }),
      });
      const j = await res.json();
      if (res.ok) setExec(j);
    } finally {
      setExecBusy(false);
    }
  }

  if (err) return <main className="report"><p className="status-line error">{err}</p></main>;
  if (!r) return <main className="report"><p className="dash-empty">Assembling your diagnosis…</p></main>;

  const scoring = r.scoring ?? {};
  // defining traits: the axes furthest from neutral — what makes this person THEM
  const defining = Object.entries(scoring)
    .map(([k, v]) => ({ k, v, d: Math.abs((v?.score ?? 0.5) - 0.5) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 3);
  const grouped = r.insights.reduce<Record<string, typeof r.insights>>((acc, i) => {
    (acc[i.dimension] ??= []).push(i);
    return acc;
  }, {});

  return (
    <main className="report">
      <div className="report-top no-print">
        <a className="ghost-btn" href="/dashboard">← Dashboard</a>
        <UserChip />
      </div>

      <header className="report-head">
        <div className="report-kicker">drizzle · about you</div>
        <h1>{r.profile.fullName ?? "You"}</h1>
        {r.profile.headline && <p className="report-headline">{r.profile.headline}</p>}
        <div className="report-meta">
          {/* "7/8/2026" is ambiguous for an Indian audience — spell the month */}
          {r.scoringAt ? `Profile read updated ${new Date(r.scoringAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "Profile read pending"} ·{" "}
          {r.insights.length} insight{r.insights.length === 1 ? "" : "s"} from mentor conversations
        </div>
        {defining.length > 0 && (
          <div className="trait-chips">
            {defining.map(({ k, v }) => (
              <span className="trait-chip" key={k} title={v.rationale}>
                {k.replace(/_/g, " ")} · {v.score >= 0.5 ? "high" : "low"}
              </span>
            ))}
          </div>
        )}
        {r.about && <AboutFactsPanel userId={userId} about={r.about} onSaved={() => void load()} />}
      </header>

      <section className="report-section">
        <div className="report-sec-head">
          <h2><span className="sec-num">01</span> Executive read</h2>
          {!exec && (
            <button className="btn-primary" onClick={() => void generateExec()} disabled={execBusy}>
              {execBusy ? "Reading your file…" : "Generate"}
            </button>
          )}
        </div>
        {exec ? (
          <div className="exec-read">
            <p className="exec-readline">“{exec.readline}”</p>
            {exec.narrative.map((p, i) => (
              <p className="exec-para" key={i}>{p}</p>
            ))}
            <div className="exec-moves">
              <div className="exec-moves-label">The moves</div>
              <ol>
                {exec.moves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <p className="report-blurb">
            A sharp, evidence-backed narrative built from everything below — generated on demand so it&apos;s always
            current with your latest call.
          </p>
        )}
      </section>

      <section className="report-section">
        <h2><span className="sec-num">02</span> Work-style profile</h2>
        {Object.keys(scoring).length === 0 ? (
          <p className="dash-empty">No profile read yet — upload a résumé and it computes automatically.</p>
        ) : (
          AXIS_GROUPS.map((g) => (
            <div className="axis-group" key={g.title}>
              <div className="axis-group-head">
                <h3>{g.title}</h3>
                <span>{g.blurb}</span>
              </div>
              {g.axes.map((a) => {
                const p = scoring[a.key];
                if (!p) return null;
                return (
                  <div className="axis-row" key={a.key}>
                    <div className="axis-label">{a.label}</div>
                    <div className="axis-track">
                      <span className="axis-end">{a.low}</span>
                      <div className="axis-bar">
                        <div className="axis-fill" style={{ width: `${Math.round(p.score * 100)}%` }} />
                        <div className="axis-dot" style={{ left: `${Math.round(p.score * 100)}%` }} />
                      </div>
                      <span className="axis-end">{a.high}</span>
                    </div>
                    <div className="axis-why">{p.rationale}</div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </section>

      <section className="report-section">
        <h2><span className="sec-num">03</span> What your mentor has learned</h2>
        {r.insights.length === 0 ? (
          <p className="dash-empty">Nothing yet — this fills in as you talk. <a href="/mentor">Take a call →</a></p>
        ) : (
          <div className="insight-grid">
            {Object.entries(grouped).map(([dim, items]) => (
              <div className="insight-card" key={dim}>
                <div className="insight-card-head">
                  <span className="insight-icon">{DIM_META[dim]?.icon ?? "•"}</span>
                  {DIM_META[dim]?.label ?? dim}
                </div>
                <ul>
                  {items.map((i, idx) => (
                    <li key={idx}>{i.content}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {r.probes.length > 0 && (
        <section className="report-section">
          <h2><span className="sec-num">04</span> Still being tested</h2>
          <p className="report-blurb">Open questions your story raises — the mentor works these into future calls.</p>
          <ul className="probe-list">
            {r.probes.map((p, i) => (
              <li key={i}>
                {p.question}
                {p.rationale && <span className="probe-why"> — {p.rationale}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="report-section">
        <h2><span className="sec-num">{r.probes.length > 0 ? "05" : "04"}</span> Where this points</h2>
        {r.targetRole && (
          <div className="target-box">
            <div className="target-role">🎯 {r.targetRole.role}</div>
            {r.targetRole.rationale && <p>{r.targetRole.rationale}</p>}
          </div>
        )}
        {r.topMatches.length > 0 ? (
          <div className="match-strip">
            {r.topMatches.map((m, i) => (
              <a className="match-mini" key={i} href={m.url ?? "/dashboard"} target={m.url ? "_blank" : undefined} rel="noopener noreferrer">
                <span className="match-fit">{Math.round(m.fit * 100)}%</span>
                <span className="match-title">{m.title}</span>
                <span className="match-co">{displayCompany(m.company)}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="dash-empty">No live roles ranked yet.</p>
        )}
      </section>
    </main>
  );
}

const DEGREE_LABEL: Record<string, string> = { phd: "PhD", md: "MD", jd: "JD", masters: "Master's", bachelors: "Bachelor's", none: "No degree" };

/**
 * The at-a-glance facts. Derived from the résumé by default; click ✎ to pin a
 * precise value — pins win everywhere, including the job-ranking gates
 * (years + degree decide which roles are even shown).
 */
function AboutFactsPanel({ userId, about, onSaved }: { userId: string; about: About; onSaved: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(field: string, value: string | number | null) {
    setBusy(true);
    try {
      await fetch("/api/profile/about", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, [field]: value }),
      });
      setEditing(null);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const facts: { field: string; label: string; fact: Fact<string | number>; render: (v: string | number) => string; input: "text" | "number" | "degree"; gateNote?: string }[] = [
    { field: "currentEmployer", label: "Current employer", fact: about.currentEmployer, render: String, input: "text" },
    { field: "yearsExperience", label: "Years of experience", fact: about.yearsExperience, render: (v) => `${v} yrs`, input: "number", gateNote: "filters roles by required experience" },
    { field: "highestDegree", label: "Highest degree", fact: about.highestDegree, render: (v) => DEGREE_LABEL[v] ?? String(v), input: "degree", gateNote: "filters roles that require a degree you don't hold" },
    { field: "trajectory", label: "Career trajectory", fact: about.trajectory, render: String, input: "text" },
  ];

  return (
    <div className="about-facts">
      {facts.map((f) => (
        <div className={`about-fact${f.field === "trajectory" ? " wide" : ""}`} key={f.field}>
          <div className="about-fact-label">
            {f.label}
            {f.gateNote && <span className="about-fact-gate" title={`Used by matching — ${f.gateNote}`}>⛩</span>}
          </div>
          {editing === f.field ? (
            <div className="about-fact-edit">
              {f.input === "degree" ? (
                <select className="f-box" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
                  {Object.entries(DEGREE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="f-box"
                  type={f.input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void save(f.field, f.input === "number" ? Number(draft) : draft)}
                  autoFocus
                />
              )}
              <button className="tip-add" disabled={busy} onClick={() => void save(f.field, f.input === "number" ? Number(draft) : draft)}>✓</button>
              <button className="ai-cancel" onClick={() => setEditing(null)}>✕</button>
            </div>
          ) : (
            <div className="about-fact-value">
              <span>{f.fact.value !== null && f.fact.value !== undefined ? f.render(f.fact.value) : "—"}</span>
              <button
                className="about-fact-pen"
                title={f.fact.pinned ? "Pinned by you — edit" : "From your résumé — click to set precisely"}
                onClick={() => {
                  setDraft(String(f.fact.value ?? ""));
                  setEditing(f.field);
                }}
              >
                ✎
              </button>
              {f.fact.pinned && (
                <button className="about-fact-unpin" title="Unpin — go back to the résumé-derived value" onClick={() => void save(f.field, null)}>
                  📌
                </button>
              )}
            </div>
          )}
          <div className="about-fact-src">{f.fact.pinned ? "pinned by you" : "from your résumé"}</div>
        </div>
      ))}
    </div>
  );
}
