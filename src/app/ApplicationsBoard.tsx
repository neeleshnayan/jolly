"use client";

/**
 * The applications board — lives on About You (the profile view), because your
 * applications are part of YOUR story, not the job feed. Self-fetching, so any
 * page can mount it: log form → journey kanban (applied → screening →
 * interview) → outcome strips (offer 🎉 / what didn't work). Cards linked to a
 * recommended role expand into a small collapsible: the role's summary, the
 * skills it asks for, and its CURRENT match score.
 */
import { useCallback, useEffect, useState } from "react";
import { displayCompany } from "@/lib/format/company";

type Application = {
  id: string;
  company: string | null;
  role: string | null;
  status: string;
  notes: string | null;
  followUpAt: string | Date | null;
  appliedAt: string;
  resumeVersionId: string | null;
  themeName: string | null;
  opportunityId: string | null;
  summary: string | null;
  skills: string[];
  fit: number | null;
};
type Version = { id: string; themeId: string | null; label: string | null; createdAt: string; theme: string | null };

const COLUMNS = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
] as const;
const colFor = (status: string) => (COLUMNS.some((c) => c.key === status) ? status : "applied");
const isOutcome = (status: string) => status === "offer" || status === "rejected" || status === "ghosted";

const NO_OFFER_REASONS = [
  "No response after interview",
  "Rejected after interview",
  "Position was filled",
  "Comp didn't work out",
  "I withdrew",
] as const;

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const daysSince = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86400000));
const toDateInput = (d: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const overdue = (a: Application) => !!a.followUpAt && new Date(a.followUpAt).getTime() < Date.now();

export default function ApplicationsBoard({ userId }: { userId: string }) {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [appForm, setAppForm] = useState({ company: "", role: "", resumeVersionId: "" });
  const [appMsg, setAppMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/track/application?u=${userId}`, { cache: "no-store" });
      const j = await r.json();
      setApps(j.applications ?? []);
    } catch {
      setApps([]);
    }
  }, [userId]);
  useEffect(() => {
    void load();
    fetch(`/api/track/version?u=${userId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const themes = (j.themes ?? []) as { name: string; versions: Omit<Version, "theme">[] }[];
        const untagged = (j.untagged ?? []) as Omit<Version, "theme">[];
        setVersions([
          ...themes.flatMap((t) => t.versions.map((v) => ({ ...v, theme: t.name }))),
          ...untagged.map((v) => ({ ...v, theme: null })),
        ]);
      })
      .catch(() => {});
  }, [load, userId]);

  async function logApplication() {
    if (!appForm.company.trim() && !appForm.role.trim()) {
      setAppMsg("Add a company or role");
      return;
    }
    setAppMsg("Logging…");
    const res = await fetch("/api/track/application", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, ...appForm, resumeVersionId: appForm.resumeVersionId || undefined }),
    });
    const j = await res.json();
    if (res.ok) {
      const v = versions.find((x) => x.id === appForm.resumeVersionId);
      setApps((a) => [
        {
          id: j.application.id,
          company: appForm.company || null,
          role: appForm.role || null,
          status: "applied",
          notes: null,
          followUpAt: null,
          appliedAt: new Date().toISOString(),
          resumeVersionId: appForm.resumeVersionId || null,
          themeName: v?.theme ?? null,
          opportunityId: null,
          summary: null,
          skills: [],
          fit: null,
        },
        ...(a ?? []),
      ]);
      setAppForm({ company: "", role: "", resumeVersionId: "" });
      setAppMsg("");
    } else {
      setAppMsg(j.error || "Couldn't log");
    }
  }

  async function setStatus(id: string, stage: string, result?: string) {
    setApps((a) => (a ?? []).map((x) => (x.id === id ? { ...x, status: stage } : x)));
    await fetch("/api/track/application", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, applicationId: id, stage, ...(result ? { result } : {}) }),
    });
  }

  const [celebrating, setCelebrating] = useState(false);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  function gotOffer(id: string) {
    void setStatus(id, "offer");
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 2600);
  }
  function noOffer(id: string, reason: string) {
    void setStatus(id, /no response/i.test(reason) ? "ghosted" : "rejected", reason);
    setReasonFor(null);
  }

  async function saveCard(id: string, patch: { notes?: string | null; followUpAt?: string | null }) {
    setApps((a) => (a ?? []).map((x) => (x.id === id ? { ...x, ...("notes" in patch ? { notes: patch.notes ?? null } : {}), ...("followUpAt" in patch ? { followUpAt: patch.followUpAt ?? null } : {}) } : x)));
    await fetch("/api/track/application", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, applicationId: id, ...patch }),
    });
  }

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  function dropOn(colKey: string) {
    if (!dragId) return;
    const app = (apps ?? []).find((a) => a.id === dragId);
    setDragId(null);
    setDragOver(null);
    if (!app || isOutcome(app.status) || colFor(app.status) === colKey) return;
    void setStatus(app.id, colKey);
  }
  const [followOpen, setFollowOpen] = useState<Record<string, boolean>>({});
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});
  const [detailOpen, setDetailOpen] = useState<Record<string, boolean>>({});

  if (apps === null) return <p className="dash-empty">Loading your applications…</p>;

  return (
    <>
      <div className="app-new">
        <input className="f-box" value={appForm.company} placeholder="Company" onChange={(e) => setAppForm((f) => ({ ...f, company: e.target.value }))} />
        <input className="f-box" value={appForm.role} placeholder="Role" onChange={(e) => setAppForm((f) => ({ ...f, role: e.target.value }))} />
        <select
          className="f-box"
          value={appForm.resumeVersionId}
          onChange={(e) => setAppForm((f) => ({ ...f, resumeVersionId: e.target.value }))}
          title="Optional — which résumé version you sent. Linking versions to outcomes is how drizzle learns which framing of you actually lands interviews."
        >
          <option value="">Résumé version sent (optional)</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {(v.theme ? `${v.theme} · ` : "") + fmtDate(v.createdAt)}
            </option>
          ))}
        </select>
        <button className="ghost-btn" onClick={logApplication}>+ Log</button>
        {appMsg && <span className="dash-hint">{appMsg}</span>}
      </div>
      {apps.length === 0 ? (
        <p className="dash-empty">No applications logged yet — confirm one from a dashboard recommendation, or log it above.</p>
      ) : (
        <>
          <div className="kanban kanban-journey">
            {COLUMNS.map((col) => {
              const cards = apps.filter((a) => !isOutcome(a.status) && colFor(a.status) === col.key);
              return (
                <div
                  key={col.key}
                  className={`kanban-col${dragOver === col.key ? " drop-target" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(col.key);
                  }}
                  onDragLeave={() => setDragOver((v) => (v === col.key ? null : v))}
                  onDrop={() => dropOn(col.key)}
                >
                  <div className="kanban-col-head">
                    {col.label} <span className="kanban-count">{cards.length}</span>
                  </div>
                  {cards.map((a) => (
                    <div
                      key={a.id}
                      className={`kanban-card${dragId === a.id ? " dragging" : ""}`}
                      draggable
                      onDragStart={() => setDragId(a.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOver(null);
                      }}
                    >
                      <div className="kanban-card-top">
                        <div>
                          <div className="kanban-card-co">{displayCompany(a.company) || "—"}</div>
                          {a.role && <div className="kanban-card-role">{a.role}</div>}
                        </div>
                        <span className="kanban-card-icons">
                          <button
                            className={`kanban-icon${a.followUpAt ? " has" : ""}`}
                            onClick={() => setFollowOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                            title={a.followUpAt ? `Follow up ${fmtDate(String(a.followUpAt))}` : "Set a follow-up date"}
                          >
                            ⏰
                          </button>
                          <button
                            className={`kanban-icon${a.notes ? " has" : ""}`}
                            onClick={() => setNotesOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                            title={a.notes ? "Notes" : "Add a note"}
                          >
                            🗒
                          </button>
                        </span>
                      </div>
                      <div className="kanban-card-meta">
                        {a.fit !== null && <span className="kanban-chip fit">{Math.round(a.fit * 100)}% match</span>}
                        {a.themeName && <span className="kanban-chip">{a.themeName}</span>}
                        <span className="kanban-age" title={`Logged ${fmtDate(a.appliedAt)}`}>{daysSince(a.appliedAt)}d</span>
                        {a.followUpAt && !overdue(a) && <span className="kanban-follow-on">⏰ {fmtDate(String(a.followUpAt))}</span>}
                        {overdue(a) && <span className="kanban-overdue" title="Follow-up date has passed">follow up!</span>}
                      </div>
                      {(a.summary || a.skills.length > 0) && (
                        <button className="kanban-detail-toggle" onClick={() => setDetailOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}>
                          {detailOpen[a.id] ? "▾ about this role" : "▸ about this role"}
                        </button>
                      )}
                      {detailOpen[a.id] && (
                        <div className="kanban-detail">
                          {a.summary && <p className="kanban-detail-summary">{a.summary}</p>}
                          {a.skills.length > 0 && (
                            <div className="kanban-detail-skills">
                              {a.skills.map((s) => (
                                <span className="rec-chip" key={s}>{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {followOpen[a.id] && (
                        <input
                          className="kanban-follow-input"
                          type="date"
                          value={toDateInput(a.followUpAt)}
                          onChange={(e) => void saveCard(a.id, { followUpAt: e.target.value || null })}
                        />
                      )}
                      {notesOpen[a.id] && (
                        <textarea
                          className="kanban-notes"
                          defaultValue={a.notes ?? ""}
                          placeholder="Recruiter name, next step, links…"
                          rows={3}
                          onBlur={(e) => void saveCard(a.id, { notes: e.target.value })}
                        />
                      )}
                      {col.key === "interview" &&
                        (reasonFor === a.id ? (
                          <div className="kanban-reasons">
                            <div className="kanban-reasons-label">What happened?</div>
                            {NO_OFFER_REASONS.map((r) => (
                              <button key={r} className="kanban-reason" onClick={() => noOffer(a.id, r)}>
                                {r}
                              </button>
                            ))}
                            <button className="ai-cancel" onClick={() => setReasonFor(null)}>never mind</button>
                          </div>
                        ) : (
                          <div className="kanban-branch">
                            <button className="kanban-offer-btn" onClick={() => gotOffer(a.id)}>🎉 Got the offer</button>
                            <button className="kanban-nooffer-btn" onClick={() => setReasonFor(a.id)}>No offer</button>
                          </div>
                        ))}
                    </div>
                  ))}
                  {cards.length === 0 && <div className="kanban-empty">—</div>}
                </div>
              );
            })}
          </div>

          {apps.some((a) => a.status === "offer") && (
            <div className="outcome-strip offers">
              <div className="outcome-strip-head">🎉 Offers</div>
              {apps.filter((a) => a.status === "offer").map((a) => (
                <div className="outcome-card offer" key={a.id}>
                  <span className="outcome-co">{displayCompany(a.company) || "—"}</span>
                  {a.role && <span className="outcome-role">{a.role}</span>}
                  <span className="kanban-age">{fmtDate(a.appliedAt)}</span>
                </div>
              ))}
            </div>
          )}
          {apps.some((a) => a.status === "rejected" || a.status === "ghosted") && (
            <div className="outcome-strip closed">
              <div className="outcome-strip-head">Didn&apos;t work out — each one teaches the ranking</div>
              {apps.filter((a) => a.status === "rejected" || a.status === "ghosted").map((a) => (
                <div className="outcome-card" key={a.id}>
                  <span className="outcome-co">{displayCompany(a.company) || "—"}</span>
                  {a.role && <span className="outcome-role">{a.role}</span>}
                  <span className="kanban-chip">{a.status === "ghosted" ? "no response" : "rejected"}</span>
                </div>
              ))}
            </div>
          )}
          {celebrating && <Confetti />}
        </>
      )}
    </>
  );
}

/** A 2.5s burst of falling pieces — an offer is a big deal, act like it. */
function Confetti() {
  const pieces = Array.from({ length: 90 }, (_, i) => i);
  const colors = ["#2563eb", "#0f766e", "#f59e0b", "#ec4899", "#22c55e", "#7aa5f8"];
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${(i * 137.5) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 12) * 0.09}s`,
            animationDuration: `${1.6 + ((i * 7) % 10) / 10}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
