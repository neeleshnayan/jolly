"use client";

import { useEffect, useState } from "react";
import Recommendations from "./Recommendations";
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

      {/* the mentor circle lives right here — no separate page to remember */}
      <MentorStrip userId={userId} />

      <Recommendations userId={userId} />
    </main>
  );
}

/** Mentor Connect, flattened: the top matches inline on the dashboard. The
 *  full view (profile form, pre-brief preview, intro notes) stays at /mentors. */
function MentorStrip({ userId }: { userId: string }) {
  type Mini = { id: string; name: string | null; avatarUrl: string | null; headline: string | null; score: number; why: string[] };
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
        <a className="refine-toggle" href="/mentors">Open Mentor Connect →</a>
      </div>
      {matches === null ? (
        <p className="dash-empty">Finding people who&apos;ve walked your path…</p>
      ) : matches.length === 0 ? (
        <p className="dash-empty">No mentors to connect yet — the circle is still forming. Know someone who&apos;s made your move? Invite them via Mentor Connect.</p>
      ) : (
        <div className="mentor-strip">
          {matches.map((m) => (
            <a className="mentor-strip-card" key={m.id} href="/mentors">
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="mentor-avatar" src={m.avatarUrl} alt="" />
              ) : (
                <span className="mentor-avatar mentor-avatar-fallback">{(m.name ?? "?").slice(0, 1)}</span>
              )}
              <span className="mentor-strip-body">
                <span className="mentor-name">{m.name ?? "Mentor"}</span>
                <span className="mentor-headline">{m.headline ?? ""}</span>
                {m.why[0] && <span className="mentor-strip-why">{m.why[0]}</span>}
              </span>
              {m.score > 0 && <span className="mentor-fit">{Math.round(m.score * 100)}%</span>}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
