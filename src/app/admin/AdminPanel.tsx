"use client";

import { useCallback, useEffect, useState } from "react";

type Metrics = {
  mentorCalls: { total: number; byUser: { who: string; n: number; last_at: string }[] };
  resumeEdits: { total: number; users: number };
  applications: { total: number; users: number; last7: number };
  activity: { active_today: number; active_week: number; registered: number; new_week: number } | null;
  byModel: { model: string; runs: number; tokens_in: number; tokens_out: number }[];
  agents: {
    agent: string;
    runs: number;
    errors: number;
    avg_ms: number | null;
    tokens_in: number;
    tokens_out: number;
    last_at: string;
  }[];
  recentRuns: { agent: string; status: string; model: string | null; duration_ms: number | null; error: string | null; created_at: string }[];
};

const fmtMs = (ms: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

// $/Mtok for hosted models — local models are ₹0 (your rig). This is THE
// dollars-per-outcome view: tokens × price, per model.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
function estCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = Object.entries(PRICE_PER_MTOK).find(([k]) => model.includes(k))?.[1];
  if (!p) return 0;
  return (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
}

type Tab = "usage" | "inference" | "jobs";

type JobRow = {
  id: string;
  source: string;
  title: string | null;
  company: string | null;
  location: string | null;
  remote: string | null;
  compMin: number | null;
  compMax: number | null;
  domain: string | null;
  companyStage: string | null;
  url: string | null;
  vectorizedAt: string | null;
  createdAt: string;
};
const fmtComp = (min: number | null, max: number | null) => {
  if (!min && !max) return "—";
  const f = (n: number) => (n >= 100000 ? `${Math.round(n / 100000)}L` : `${Math.round(n / 1000)}k`);
  return `₹${f(min ?? max!)}–${f(max ?? min!)}`;
};

export default function AdminPanel() {
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(false);
  const [inferring, setInferring] = useState(false);
  const [inferCount, setInferCount] = useState("10");
  const [inferBatch, setInferBatch] = useState("5");
  const [inferPause, setInferPause] = useState("30");
  type Progress = { running: boolean; total: number; done: number; failed: number; current: string | null };
  const [prog, setProg] = useState<Progress | null>(null);
  // poll live progress while a run is active
  useEffect(() => {
    if (!inferring) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/admin/run-inference", { cache: "no-store" });
        const j = await r.json();
        if (r.ok) setProg(j.progress);
      } catch {}
    }, 2500);
    return () => clearInterval(id);
  }, [inferring]);
  const [fetchLog, setFetchLog] = useState<string[] | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [pending, setPending] = useState(0);
  const [tab, setTab] = useState<Tab>("usage");
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobStatus, setJobStatus] = useState<"all" | "pending" | "vectorized">("all");
  const [jobQ, setJobQ] = useState("");
  const [jobPage, setJobPage] = useState(0);
  const PAGE = 50;
  type Stats = {
    verticals: { vertical: string; total: number; done: number }[];
    boards: { company: string | null; total: number; done: number }[];
  };
  const [stats, setStats] = useState<Stats | null>(null);

  // paged on purpose — a 500-row dump once crashed the operator's browser
  const loadJobs = useCallback(
    async (status = jobStatus, q = jobQ, page = jobPage) => {
      try {
        const params = new URLSearchParams({ status, limit: String(PAGE), offset: String(page * PAGE) });
        if (q.trim()) params.set("q", q.trim());
        const r = await fetch(`/api/admin/jobs?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setJobs(j.jobs ?? []);
        setJobsTotal(j.total ?? 0);
        setPending(j.pending ?? 0);
        setStats(j.stats ?? null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load jobs");
      }
    },
    [jobStatus, jobQ, jobPage],
  );

  const load = useCallback(async () => {
    try {
      const rm = await fetch("/api/admin/metrics", { cache: "no-store" });
      const jm = await rm.json();
      if (!rm.ok) throw new Error(jm.error);
      setM(jm);
      setErr("");
      void loadJobs();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function setJobFilter(status: "all" | "pending" | "vectorized") {
    setJobStatus(status);
    setJobPage(0);
    void loadJobs(status, jobQ, 0);
  }
  function setJobPageAndLoad(page: number) {
    setJobPage(page);
    void loadJobs(jobStatus, jobQ, page);
  }

  // phase 1 — cheap board pull, no GPU
  async function refreshJobs() {
    setFetching(true);
    setFetchLog(["Pulling boards (no inference — that's the separate button)…"]);
    try {
      const r = await fetch("/api/admin/refresh-jobs", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setFetchLog(j.log ?? []);
      await load();
    } catch (e) {
      setFetchLog([`Failed: ${e instanceof Error ? e.message : "unknown error"}`]);
    } finally {
      setFetching(false);
    }
  }

  // phase 2 — GPU inference, fully operator-controlled: total, batch, cooldown
  async function runInference() {
    setInferring(true);
    const n = Math.max(1, parseInt(inferCount, 10) || 10);
    const b = Math.max(1, parseInt(inferBatch, 10) || 5);
    const p = Math.max(0, parseInt(inferPause, 10) || 30);
    setFetchLog([`Vectorizing up to ${n} pending job(s) — batches of ${b}, ${p}s cooldown. Leave this page open…`]);
    try {
      const r = await fetch("/api/admin/run-inference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: n, batch: b, sleepSec: p }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setFetchLog(j.log ?? []);
      await load();
    } catch (e) {
      setFetchLog([`Failed: ${e instanceof Error ? e.message : "unknown error"}`]);
    } finally {
      setInferring(false);
      setProg(null);
    }
  }

  async function deleteJob(id: string) {
    await fetch(`/api/admin/jobs?id=${id}`, { method: "DELETE" });
    setJobs((cur) => cur.filter((j) => j.id !== id));
  }

  if (err) return <div className="admin-wrap"><p className="ai-err">{err}</p></div>;
  if (!m) return <div className="admin-wrap"><p className="dash-empty">Loading metrics…</p></div>;

  const totalSpend = m.byModel.reduce((s, x) => s + estCost(x.model, x.tokens_in, x.tokens_out), 0);

  return (
    <div className="admin-wrap">
      <div className="admin-head">
        <h1>Control room</h1>
        <button className="refine-toggle" onClick={() => void load()}>↻ Reload</button>
      </div>

      <div className="admin-tabs">
        {(["usage", "inference", "jobs"] as Tab[]).map((t) => (
          <button key={t} className={`admin-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "usage" ? "📊 Usage" : t === "inference" ? "🧮 LLM inference" : `⚙ Jobs${pending ? ` (${pending})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "usage" && (
        <>
          <div className="admin-stats">
            <div className="admin-stat">
              <div className="admin-stat-n">{m.activity?.active_today ?? 0}</div>
              <div className="admin-stat-l">Active today · {m.activity?.active_week ?? 0} this week</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-n">{m.activity?.registered ?? 0}</div>
              <div className="admin-stat-l">Registered · {m.activity?.new_week ?? 0} new this week</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-n">{m.mentorCalls.total}</div>
              <div className="admin-stat-l">Mentor conversations</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-n">{m.resumeEdits.total}</div>
              <div className="admin-stat-l">Résumé edits · {m.resumeEdits.users} user{m.resumeEdits.users === 1 ? "" : "s"}</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-n">{m.applications.total}</div>
              <div className="admin-stat-l">Applications · {m.applications.last7} this week</div>
            </div>
          </div>
          <p className="admin-note">
            &ldquo;Active&rdquo; = any recorded action (upload, edit, call). Real session tracking lands with the first outside users.
          </p>

          <section className="admin-section">
            <h2>Mentor conversations by user</h2>
            {m.mentorCalls.byUser.length === 0 ? (
              <p className="dash-empty">None yet.</p>
            ) : (
              <table className="admin-table">
                <thead><tr><th>User</th><th>Calls</th><th>Last</th></tr></thead>
                <tbody>
                  {m.mentorCalls.byUser.map((u, i) => (
                    <tr key={i}><td>{u.who}</td><td>{u.n}</td><td>{fmtAgo(u.last_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {tab === "inference" && (
        <>
          <div className="admin-stats">
            <div className="admin-stat">
              <div className="admin-stat-n">${totalSpend.toFixed(2)}</div>
              <div className="admin-stat-l">Est. hosted-LLM spend (all time)</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-n">{m.agents.reduce((s, a) => s + a.runs, 0)}</div>
              <div className="admin-stat-l">Agent runs · {m.agents.reduce((s, a) => s + a.errors, 0)} errors</div>
            </div>
          </div>

          <section className="admin-section">
            <h2>Spend by model</h2>
            <table className="admin-table">
              <thead><tr><th>Model</th><th>Runs</th><th>Tokens in/out</th><th>Est. cost</th></tr></thead>
              <tbody>
                {m.byModel.map((x) => {
                  const c = estCost(x.model, x.tokens_in, x.tokens_out);
                  return (
                    <tr key={x.model}>
                      <td>{x.model}</td>
                      <td>{x.runs}</td>
                      <td>{fmtK(x.tokens_in)} / {fmtK(x.tokens_out)}</td>
                      <td>{c > 0 ? `$${c.toFixed(3)}` : "₹0 (local)"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="admin-section">
            <h2>By agent — the ROI ledger</h2>
            <table className="admin-table">
              <thead>
                <tr><th>Agent</th><th>Runs</th><th>Errors</th><th>Avg time</th><th>Tokens in/out</th><th>Last</th></tr>
              </thead>
              <tbody>
                {m.agents.map((a) => (
                  <tr key={a.agent}>
                    <td>{a.agent}</td>
                    <td>{a.runs}</td>
                    <td className={a.errors > 0 ? "admin-err" : ""}>{a.errors}</td>
                    <td>{fmtMs(a.avg_ms)}</td>
                    <td>{fmtK(a.tokens_in)} / {fmtK(a.tokens_out)}</td>
                    <td>{fmtAgo(a.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="admin-section">
            <h2>Recent runs</h2>
            <table className="admin-table">
              <thead><tr><th>Agent</th><th>Status</th><th>Model</th><th>Time</th><th>When</th></tr></thead>
              <tbody>
                {m.recentRuns.map((r, i) => (
                  <tr key={i}>
                    <td>{r.agent}</td>
                    <td className={r.status === "error" ? "admin-err" : ""}>{r.status}{r.error ? ` — ${r.error.slice(0, 60)}` : ""}</td>
                    <td>{r.model ?? "—"}</td>
                    <td>{fmtMs(r.duration_ms)}</td>
                    <td>{fmtAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "jobs" && (
        <>
          <div className="admin-actions" style={{ marginTop: 4 }}>
            <button className="btn-primary" onClick={() => void refreshJobs()} disabled={fetching || inferring}>
              {fetching ? "Pulling boards…" : "⟳ Fetch jobs"}
            </button>
            <span className="admin-infer">
              <label className="admin-knob" title="Total pending jobs to vectorize this run">
                total
                <input className="admin-count" type="number" min={1} max={50} value={inferCount} onChange={(e) => setInferCount(e.target.value)} />
              </label>
              <label className="admin-knob" title="Jobs per batch before a cooldown">
                batch
                <input className="admin-count" type="number" min={1} max={10} value={inferBatch} onChange={(e) => setInferBatch(e.target.value)} />
              </label>
              <label className="admin-knob" title="Seconds of GPU cooldown between batches">
                pause&nbsp;s
                <input className="admin-count" type="number" min={0} max={120} value={inferPause} onChange={(e) => setInferPause(e.target.value)} />
              </label>
              <button className="btn-primary" onClick={() => void runInference()} disabled={inferring || fetching || pending === 0}>
                {inferring ? "Vectorizing…" : `▶ Run inference${pending ? ` (${pending} pending)` : ""}`}
              </button>
            </span>
          </div>
          <p className="admin-note">
            Fetch is cheap (no GPU) — run it anytime. Inference runs batches of 5 with a 30s cooldown for thermal headroom.
            Vectorized roles rank for every user on their next dashboard load. Heads-up: inference competes with live mentor
            calls for the GPU — run it between calls.
          </p>

          {inferring && prog && prog.total > 0 && (
            <div className="infer-progress">
              <div className="infer-progress-bar">
                <div className="infer-progress-fill" style={{ width: `${Math.round(((prog.done + prog.failed) / prog.total) * 100)}%` }} />
              </div>
              <div className="infer-progress-text">
                {prog.done + prog.failed} of {prog.total} · {prog.done} ✓{prog.failed ? ` · ${prog.failed} ✗` : ""}
                {prog.current ? ` — now: ${prog.current}` : ""} · {pending - prog.done} still pending overall
              </div>
            </div>
          )}

          {fetchLog && <pre className="admin-log">{fetchLog.join("\n")}</pre>}

          {stats && (
            <section className="admin-section">
              <h2>Pipeline mix — fetch more of what&apos;s thin</h2>
              <div className="mix-grid">
                <div>
                  <div className="mix-label">By vertical (title-based, all {jobsTotal || "—"} rows)</div>
                  {stats.verticals.map((v) => {
                    const max = Math.max(...stats.verticals.map((x) => x.total), 1);
                    return (
                      <div className="mix-row" key={v.vertical}>
                        <span className="mix-name">{v.vertical}</span>
                        <span className="mix-bar">
                          <span className="mix-fill" style={{ width: `${(v.total / max) * 100}%` }}>
                            <span className="mix-done" style={{ width: `${v.total ? (v.done / v.total) * 100 : 0}%` }} />
                          </span>
                        </span>
                        <span className="mix-n">{v.done}/{v.total}</span>
                      </div>
                    );
                  })}
                  <div className="admin-note">bar = postings in DB · filled part = already vectorized</div>
                </div>
                <div>
                  <div className="mix-label">By board</div>
                  {stats.boards.slice(0, 12).map((b) => (
                    <div className="mix-row" key={b.company ?? "?"}>
                      <span className="mix-name">{b.company ?? "—"}</span>
                      <span className="mix-n">{b.done}/{b.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="admin-section">
            <div className="jobs-controls">
              <h2 style={{ margin: 0 }}>Jobs ({jobsTotal}{pending ? ` · ${pending} pending` : ""})</h2>
              <span className="jobs-filters">
                {(["all", "pending", "vectorized"] as const).map((s) => (
                  <button key={s} className={`admin-tab${jobStatus === s ? " active" : ""}`} onClick={() => setJobFilter(s)}>
                    {s}
                  </button>
                ))}
                <input
                  className="f-box jobs-search"
                  placeholder="search title/company…"
                  value={jobQ}
                  onChange={(e) => setJobQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (setJobPage(0), void loadJobs(jobStatus, jobQ, 0))}
                />
              </span>
            </div>
            <table className="admin-table admin-jobs-table">
              <thead>
                <tr><th>Title</th><th>Company</th><th>Location</th><th>Style</th><th>Comp</th><th>Domain</th><th>Src</th><th>Status</th><th>Added</th><th></th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.url ? <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a> : j.title}</td>
                    <td>{j.company}</td>
                    <td className="admin-dim">{j.location ?? "—"}</td>
                    <td className="admin-dim">{j.remote && j.remote !== "unknown" ? j.remote : "—"}</td>
                    <td className="admin-dim">{fmtComp(j.compMin, j.compMax)}</td>
                    <td className="admin-dim">{j.domain ?? "—"}{j.companyStage && j.companyStage !== "unknown" ? ` · ${j.companyStage}` : ""}</td>
                    <td className="admin-dim">{j.source}</td>
                    <td>{j.vectorizedAt ? "✓" : <span className="admin-pending">pending</span>}</td>
                    <td className="admin-dim">{fmtAgo(j.createdAt)}</td>
                    <td><button className="admin-del" onClick={() => void deleteJob(j.id)} title="Delete this job">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="jobs-pager">
              <button className="refine-toggle" disabled={jobPage === 0} onClick={() => setJobPageAndLoad(jobPage - 1)}>← Prev</button>
              <span className="dash-hint">page {jobPage + 1} of {Math.max(1, Math.ceil(jobsTotal / PAGE))}</span>
              <button className="refine-toggle" disabled={(jobPage + 1) * PAGE >= jobsTotal} onClick={() => setJobPageAndLoad(jobPage + 1)}>Next →</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
