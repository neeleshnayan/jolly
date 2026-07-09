"use client";

import { useCallback, useEffect, useState } from "react";
import Brand from "../Brand";
import UserChip from "../UserChip";

type Transition = { from: string; to: string };
type MentorMe = {
  headline: string | null;
  contactEmail: string | null;
  journey: string | null;
  expertise: string[];
  transitions: Transition[];
  languages: string | null;
  timezone: string | null;
  availability: string;
  feeHr: number | null;
  active: boolean;
} | null;
type Match = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  journey: string | null;
  expertise: string[];
  transitions: Transition[];
  availability: string;
  feeHr: number | null;
  score: number;
  why: string[];
};
type Edge = { from: string; to: string } | null;
type Suggested = { headline: string; journey: string; expertise: string[]; transitions: Transition[]; timezone: string } | null;

const AVAIL_LABEL: Record<string, string> = { occasionally: "Occasionally", "part-time": "Part-time", open: "Open to many sessions" };

export default function MentorsClient({ userId }: { userId: string }) {
  const [me, setMe] = useState<MentorMe>(null);
  const [identity, setIdentity] = useState<{ name: string | null; avatarUrl: string | null }>({ name: null, avatarUrl: null });
  const [matches, setMatches] = useState<Match[]>([]);
  const [edge, setEdge] = useState<Edge>(null);
  const [prebrief, setPrebrief] = useState("");
  const [suggested, setSuggested] = useState<Suggested>(null);
  const [loaded, setLoaded] = useState(false);
  const [showPrebrief, setShowPrebrief] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false); // an existing mentor sees their CARD; this opens the form

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/mentors?u=${userId}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) {
        setMe(j.me);
        setIdentity(j.identity ?? { name: null, avatarUrl: null });
        setMatches(j.matches ?? []);
        setEdge(j.edge);
        setPrebrief(j.prebriefPreview ?? "");
        setSuggested(j.suggested ?? null);
      }
    } finally {
      setLoaded(true);
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  // intro requests — brokered: drizzle will email the mentor on the seeker's
  // behalf (send flow lands later); the seeker never gets the address
  const [introState, setIntroState] = useState<Record<string, "ask" | "sending" | "sent">>({});
  const [introNote, setIntroNote] = useState("");
  async function requestIntro(mentorId: string) {
    setIntroState((s) => ({ ...s, [mentorId]: "sending" }));
    try {
      const r = await fetch("/api/mentors/intro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, mentorId, note: introNote }),
      });
      if (!r.ok) throw new Error();
      setIntroState((s) => ({ ...s, [mentorId]: "sent" }));
      setIntroNote("");
    } catch {
      setIntroState((s) => ({ ...s, [mentorId]: "ask" }));
    }
  }

  return (
    <main className="mentors-wrap">
      <div className="report-top no-print">
        <Brand />
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a className="ghost-btn" href="/dashboard">← Dashboard</a>
          <UserChip />
        </span>
      </div>

      <header className="mentors-head">
        <div className="report-kicker">mentor connect</div>
        <h1>People who&apos;ve made your move</h1>
        {edge && (edge.from || edge.to) && (
          <p className="mentors-edge">
            Your move: <b>{edge.from || "where you are"}</b> → <b>{edge.to || "still exploring — talk to your mentor"}</b>
          </p>
        )}
        <p className="sub">
          You don&apos;t need &ldquo;a mentor&rdquo; — you need someone who already solved your exact problem. drizzle
          matches on the journey, not the job title.
        </p>
      </header>

      <section className="report-section">
        <h2><span className="sec-num">01</span> Your matches</h2>
        {!loaded ? (
          <p className="dash-empty">Finding people who&apos;ve walked your path…</p>
        ) : matches.length === 0 ? (
          <div className="mentors-empty">
            <p>
              The founding mentor circle is still forming — you&apos;re early. Matches appear here as mentors join whose
              journeys overlap where you&apos;re headed.
            </p>
            <p className="dash-hint">Know someone who&apos;s made your move? Invite them to register below — that&apos;s how the circle grows.</p>
          </div>
        ) : (
          <div className="mentor-cards">
            {matches.map((m) => (
              <div className="mentor-card" key={m.id}>
                <div className="mentor-card-head">
                  {m.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="mentor-avatar" src={m.avatarUrl} alt="" />
                  ) : (
                    <span className="mentor-avatar mentor-avatar-fallback">{(m.name ?? "?").slice(0, 1)}</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mentor-name">{m.name ?? "Mentor"}</div>
                    <div className="mentor-headline">{m.headline ?? ""}</div>
                    <div className="mentor-meta">
                      {AVAIL_LABEL[m.availability] ?? m.availability} · {m.feeHr ? `₹${m.feeHr.toLocaleString()}/hr` : "Free (founding mentor)"}
                    </div>
                  </div>
                  <span className="mentor-fit">{Math.round(m.score * 100)}%</span>
                </div>
                {m.transitions.length > 0 && (
                  <div className="mentor-transitions">
                    {m.transitions.map((t, i) => (
                      <span className="mentor-transition" key={i}>{t.from} → {t.to}</span>
                    ))}
                  </div>
                )}
                {m.journey && <p className="mentor-journey">{m.journey.slice(0, 260)}</p>}
                {m.why.length > 0 && (
                  <ul className="mentor-why">
                    {m.why.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                {introState[m.id] === "sent" ? (
                  <div className="apply-confirm done">✓ Intro requested — drizzle reaches out on your behalf with your brief</div>
                ) : introState[m.id] === "ask" || introState[m.id] === "sending" ? (
                  <div className="intro-ask">
                    <textarea
                      className="job-target-jd"
                      rows={2}
                      placeholder="One line on what you'd want to ask them (goes into your intro brief)…"
                      value={introNote}
                      onChange={(e) => setIntroNote(e.target.value)}
                    />
                    <button className="btn-primary" onClick={() => void requestIntro(m.id)} disabled={introState[m.id] === "sending"}>
                      {introState[m.id] === "sending" ? "Sending…" : "Send request"}
                    </button>
                  </div>
                ) : (
                  <button className="tip-add" onClick={() => setIntroState((s) => ({ ...s, [m.id]: "ask" }))}>
                    🤝 Request an intro
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <button className="rail-add" style={{ marginTop: 14 }} onClick={() => setShowPrebrief((v) => !v)}>
          👀 {showPrebrief ? "Hide" : "Preview"} what a mentor receives about you
        </button>
        {showPrebrief && <pre className="prebrief-preview">{prebrief || "Upload a résumé and take a mentor call first — the brief writes itself from what drizzle learns."}</pre>}
      </section>

      <section className="report-section">
        <h2><span className="sec-num">02</span> {me ? "Your mentor profile" : "Become a mentor"}</h2>
        <p className="report-blurb">
          Made a move someone else is dreaming about? Every intro arrives pre-briefed — who they are, what they&apos;re
          chasing, what they want from you — so you never take a cold call.
        </p>
        {!showForm && !me && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>I&apos;d like to mentor →</button>
        )}
        {/* an existing mentor sees their card EXACTLY as seekers do — editing is a deliberate step */}
        {me && !editing && (
          <div className="mentor-card mentor-card-own">
            <div className="mentor-own-kicker">
              <span>how seekers see you{me.active ? "" : " (currently hidden — not visible to seekers)"}</span>
              <button className="ghost-btn" onClick={() => setEditing(true)}>✎ Edit your card</button>
            </div>
            <div className="mentor-card-head">
              {identity.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="mentor-avatar" src={identity.avatarUrl} alt="" />
              ) : (
                <span className="mentor-avatar mentor-avatar-fallback">{(identity.name ?? "?").slice(0, 1)}</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mentor-name">{identity.name ?? "You"}</div>
                <div className="mentor-headline">{me.headline ?? ""}</div>
                <div className="mentor-meta">
                  {AVAIL_LABEL[me.availability] ?? me.availability} · {me.feeHr ? `₹${me.feeHr.toLocaleString()}/hr` : "Free (founding mentor)"}
                </div>
              </div>
            </div>
            {me.transitions.length > 0 && (
              <div className="mentor-transitions">
                {me.transitions.map((t, i) => (
                  <span className="mentor-transition" key={i}>{t.from} → {t.to}</span>
                ))}
              </div>
            )}
            {me.journey && <p className="mentor-journey">{me.journey.slice(0, 260)}</p>}
            {me.expertise.length > 0 && (
              <div className="mentor-transitions">
                {me.expertise.map((e) => (
                  <span className="rec-chip" key={e}>{e}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {(showForm || (me && editing)) && (
          <MentorForm
            userId={userId}
            initial={
              me ??
              (suggested
                ? { headline: suggested.headline, contactEmail: null, journey: suggested.journey, expertise: suggested.expertise, transitions: suggested.transitions, languages: null, timezone: suggested.timezone || null, availability: "occasionally", feeHr: null, active: true }
                : null)
            }
            exists={!!me}
            onSaved={async () => {
              await load();
              setEditing(false); // back to the card — the point is seeing what changed
              setShowForm(false);
            }}
          />
        )}
        {showForm && !me && suggested && (
          <p className="dash-hint" style={{ marginTop: 8 }}>
            Pre-filled from your résumé and calls — edit anything, then join.
          </p>
        )}
      </section>
    </main>
  );
}

function MentorForm({ userId, initial, exists, onSaved }: { userId: string; initial: MentorMe; exists: boolean; onSaved: () => Promise<void> }) {
  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [journey, setJourney] = useState(initial?.journey ?? "");
  const [expertise, setExpertise] = useState((initial?.expertise ?? []).join(", "));
  const [transitions, setTransitions] = useState<Transition[]>(initial?.transitions?.length ? initial.transitions : [{ from: "", to: "" }]);
  const [languages, setLanguages] = useState(initial?.languages ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "");
  const [availability, setAvailability] = useState(initial?.availability ?? "occasionally");
  const [fee, setFee] = useState(initial?.feeHr ? String(initial.feeHr) : "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/mentors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          u: userId,
          headline,
          contactEmail,
          journey,
          expertise: expertise.split(",").map((s) => s.trim()).filter(Boolean),
          transitions: transitions.filter((t) => t.from.trim() && t.to.trim()),
          languages,
          timezone,
          availability,
          feeHr: fee.trim() ? Number(fee) : null,
          active,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setMsg("Saved ✓");
      await onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mentor-form">
      <label className="refine-field">
        <span>Headline</span>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Product lead at Stripe, ex-Goldman Ops" />
      </label>
      <label className="refine-field">
        <span>Contact email — where drizzle sends you intro requests (never shown to seekers)</span>
        <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      <label className="refine-field">
        <span>Your journey — the story, in your words</span>
        <textarea rows={4} value={journey} onChange={(e) => setJourney(e.target.value)} placeholder="Where you started, the move(s) you made, what you learned the hard way…" />
      </label>
      <div className="refine-field">
        <span>Transitions you&apos;ve made (this is what we match on)</span>
        {transitions.map((t, i) => (
          <div className="transition-row" key={i}>
            <input value={t.from} placeholder="from — e.g. Goldman Operations" onChange={(e) => setTransitions((ts) => ts.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <span>→</span>
            <input value={t.to} placeholder="to — e.g. Product Management" onChange={(e) => setTransitions((ts) => ts.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            {transitions.length > 1 && (
              <button className="admin-del" onClick={() => setTransitions((ts) => ts.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}
        <button className="refine-toggle" style={{ alignSelf: "flex-start" }} onClick={() => setTransitions((ts) => [...ts, { from: "", to: "" }])}>+ another move</button>
      </div>
      <div className="refine-grid">
        <label className="refine-field">
          <span>Expertise (comma-separated)</span>
          <input value={expertise} onChange={(e) => setExpertise(e.target.value)} placeholder="MBA applications, fundraising, PM interviews" />
        </label>
        <label className="refine-field">
          <span>Availability</span>
          <select value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value="occasionally">Occasionally</option>
            <option value="part-time">Part-time</option>
            <option value="open">Open to many sessions</option>
          </select>
        </label>
        <label className="refine-field">
          <span>Fee (₹/hr — leave empty to join as a free founding mentor)</span>
          <input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0 = free" />
        </label>
        <label className="refine-field">
          <span>Languages · Timezone</span>
          <span style={{ display: "flex", gap: 8 }}>
            <input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Hindi" />
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="IST" />
          </span>
        </label>
      </div>
      <div className="refine-actions">
        <label className="dash-hint" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> visible to seekers
        </label>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {msg && <span className="dash-hint">{msg}</span>}
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : exists ? "Update profile" : "Join as a mentor"}
          </button>
        </span>
      </div>
    </div>
  );
}
