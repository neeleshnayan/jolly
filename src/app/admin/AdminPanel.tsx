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
  url: string | null;
  vectorizedAt: string | null;
  createdAt: string;
};

export default function AdminPanel() {
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(false);
  const [inferring, setInferring] = useState(false);
  const [inferCount, setInferCount] = useState("10");
  const [fetchLog, setFetchLog] = useState<string[] | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [pending, setPending] = useState(0);
  const [tab, setTab] = useState<Tab>("usage");

  const load = useCallback(async () => {
    try {
      const [rm, rj] = await Promise.all([
        fetch("/api/admin/metrics", { cache: "no-store" }),
        fetch("/api/admin/jobs", { cache: "no-store" }),
      ]);
      const jm = await rm.json();
      const jj = await rj.json();
      if (!rm.ok) throw new Error(jm.error);
      setM(jm);
      if (rj.ok) {
        setJobs(jj.jobs ?? []);
        setPending(jj.pending ?? 0);
      }
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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

  // phase 2 — GPU inference in batches of 5 with a 30s cooldown between batches
  async function runInference() {
    setInferring(true);
    const n = Math.max(1, parseInt(inferCount, 10) || 10);
    setFetchLog([`Vectorizing up to ${n} pending job(s) — batches of 5, 30s cooldown. Leave this page open…`]);
    try {
      const r = await fetch("/api/admin/run-inference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: n }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setFetchLog(j.log ?? []);
      await load();
    } catch (e) {
      setFetchLog([`Failed: ${e instanceof Error ? e.message : "unknown error"}`]);
    } finally {
      setInferring(false);
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
              <input
                className="admin-count"
                type="number"
                min={1}
                max={50}
                value={inferCount}
                onChange={(e) => setInferCount(e.target.value)}
                title="How many pending jobs to vectorize this run"
              />
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

          {fetchLog && <pre className="admin-log">{fetchLog.join("\n")}</pre>}

          <section className="admin-section">
            <h2>All jobs in DB ({jobs.length}{pending ? ` · ${pending} awaiting inference` : ""})</h2>
            <table className="admin-table">
              <thead><tr><th>Title</th><th>Company</th><th>Source</th><th>Status</th><th>Added</th><th></th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.url ? <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a> : j.title}</td>
                    <td>{j.company}</td>
                    <td>{j.source}</td>
                    <td>{j.vectorizedAt ? "vectorized" : <span className="admin-pending">pending</span>}</td>
                    <td>{fmtAgo(j.createdAt)}</td>
                    <td><button className="admin-del" onClick={() => void deleteJob(j.id)} title="Delete this job">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
