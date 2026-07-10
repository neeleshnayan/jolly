"use client";

import { useEffect, useState } from "react";
import Recommendations from "./Recommendations";
import DrizzleLoader from "../DrizzleLoader";
import Brand from "../Brand";
import UserChip from "../UserChip";

export default function DashboardClient({
  userId,
  name,
  hasResume,
}: {
  userId: string;
  name: string | null;
  hasResume: boolean;
}) {
  const first = (name ?? "there").split(" ")[0];

  return (
    <main className="dash">
      <header className="dash-top">
        <Brand />
        <UserChip />
      </header>

      <h1 className="dash-hello">Hi {first} 👋</h1>
      <p className="dash-sub">Everything about your search in one place.</p>

      <div className="dash-cards">
        <a className="dash-card" href="/resume">
          <div className="dash-card-title">Your résumé</div>
          <div className="dash-card-desc">{hasResume ? "Edit, restyle, and version it" : "Upload one to get started"}</div>
        </a>
        <a className="dash-card" href="/mentor">
          <div className="dash-card-title">Talk to your mentor</div>
          <div className="dash-card-desc">A short voice call to go deeper</div>
        </a>
        <a className="dash-card" href="/insights">
          <div className="dash-card-title">About you</div>
          <div className="dash-card-desc">Your profile, diagnosis &amp; applications</div>
        </a>
      </div>

      <Recommendations userId={userId} />

      {/* people after the jobs: once you've seen what's out there, here's who
          can help you get it — no separate page to remember */}
      <MentorStrip userId={userId} />
    </main>
  );
}

/** Mentor Connect, flattened: the top matches inline on the dashboard. The
 *  full view (profile form, pre-brief preview, intro notes) stays at /mentors. */
function MentorStrip({ userId }: { userId: string }) {
  type Mini = {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    headline: string | null;
    journey: string | null;
    expertise: string[];
    transitions: { from: string; to: string }[];
    availability: string;
    feeHr: number | null;
    score: number;
    why: string[];
  };
  const AVAIL: Record<string, string> = { occasionally: "Occasionally", "part-time": "Part-time", open: "Open to many sessions" };
  const [matches, setMatches] = useState<Mini[] | null>(null);

  useEffect(() => {
    fetch(`/api/mentors?u=${userId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMatches((j.matches ?? []).slice(0, 3)))
      .catch(() => setMatches([]));
  }, [userId]);

  return (
    <section className="dash-section">
      <div className="dash-section-head">
        <h2>Your mentor circle</h2>
        <span className="dash-hint">People who&apos;ve already made your move</span>
        <a className="refine-toggle" href="/mentors">Open Mentor Connect →</a>
      </div>
      {matches === null ? (
        <DrizzleLoader row size={24} label="Finding people who've walked your path…" />
      ) : matches.length === 0 ? (
        <p className="dash-empty">No mentors to connect yet — the circle is still forming. Know someone who&apos;s made your move? Invite them via Mentor Connect.</p>
      ) : (
        <div className="mentor-strip">
          {matches.map((m) => (
            <a className="mentor-strip-card" key={m.id} href="/mentors">
              <span className="mentor-strip-top">
                {m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="mentor-avatar" src={m.avatarUrl} alt="" />
                ) : (
                  <span className="mentor-avatar mentor-avatar-fallback">{(m.name ?? "?").slice(0, 1)}</span>
                )}
                <span className="mentor-strip-body">
                  <span className="mentor-name">{m.name ?? "Mentor"}</span>
                  <span className="mentor-headline">{m.headline ?? ""}</span>
                </span>
                {m.score > 0 && <span className="mentor-fit">{Math.round(m.score * 100)}%</span>}
              </span>
              {m.transitions.length > 0 && (
                <span className="mentor-transitions">
                  {m.transitions.slice(0, 2).map((t, i) => (
                    <span className="mentor-transition" key={i}>{t.from} <span className="arw">→</span> {t.to}</span>
                  ))}
                </span>
              )}
              {m.why[0] && <span className="mentor-strip-why">{m.why[0]}</span>}
              {m.journey && <span className="mentor-strip-journey">{m.journey.slice(0, 140)}</span>}
              <span className="mentor-strip-foot">
                {m.expertise.slice(0, 3).map((e) => (
                  <span className="rec-chip" key={e}>{e}</span>
                ))}
                <span className="mentor-strip-meta">{AVAIL[m.availability] ?? m.availability} · {m.feeHr ? `₹${m.feeHr.toLocaleString()}/hr` : "Free"}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
