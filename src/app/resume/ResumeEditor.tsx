"use client";

import { useState } from "react";

// ---- local shapes (avoid pulling drizzle into the client bundle) ----
type Link = { label: string; url: string };
type Bullet = { text: string; sourceId?: string };

interface Profile {
  id: string;
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: Link[] | null;
}
interface Experience {
  id: string;
  org: string | null;
  title: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean | null;
  bullets: Bullet[] | null;
}
interface Education {
  id: string;
  institution: string | null;
  degree: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
  details: string | null;
}
interface Skill {
  id: string;
  name: string;
  category: string | null;
}
interface Project {
  id: string;
  name: string | null;
  description: string | null;
  bullets: Bullet[] | null;
}
interface FullProfile {
  profile: Profile;
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
  projects: Project[];
}

export default function ResumeEditor({
  userId,
  initial,
}: {
  userId: string;
  initial: FullProfile;
}) {
  const [data, setData] = useState<FullProfile>(initial);
  const [status, setStatus] = useState("");

  async function save(kind: string, id: string | undefined, patch: object) {
    setStatus("Saving…");
    try {
      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, kind, id, patch }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStatus("Saved ✓");
      setTimeout(() => setStatus(""), 1200);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    }
  }

  const p = data.profile;

  return (
    <>
      <div className="topbar">
        <span className="brand">Career Co-Pilot</span>
        <span className="status">{status}</span>
      </div>

      <main className="resume-wrap">
        <div className="resume">
          {/* header */}
          <Field
            className="f name"
            value={p.fullName}
            placeholder="Your name"
            onSave={(v) => {
              setData((d) => ({ ...d, profile: { ...d.profile, fullName: v } }));
              save("profile", undefined, { fullName: v });
            }}
            wrapClass="name"
          />
          <Field
            className="f headline"
            value={p.headline}
            placeholder="Headline (e.g. Senior Backend Engineer)"
            onSave={(v) => {
              setData((d) => ({ ...d, profile: { ...d.profile, headline: v } }));
              save("profile", undefined, { headline: v });
            }}
            wrapClass="headline"
          />
          <div className="contact">
            <InlineField value={p.email} placeholder="email" onSave={(v) => save("profile", undefined, { email: v })} />
            <InlineField value={p.phone} placeholder="phone" onSave={(v) => save("profile", undefined, { phone: v })} />
            <InlineField value={p.location} placeholder="location" onSave={(v) => save("profile", undefined, { location: v })} />
          </div>

          {/* experience */}
          {data.experiences.length > 0 && (
            <section className="section">
              <h2>Experience</h2>
              {data.experiences.map((e) => (
                <div className="entry" key={e.id}>
                  <div className="row">
                    <Field
                      className="f title"
                      value={e.title}
                      placeholder="Title"
                      onSave={(v) => save("experience", e.id, { title: v })}
                      wrapClass="title"
                    />
                    <DatesField
                      start={e.startDate}
                      end={e.endDate}
                      onSave={(patch) => save("experience", e.id, patch)}
                    />
                  </div>
                  <Field
                    className="f org"
                    value={e.org}
                    placeholder="Organization"
                    onSave={(v) => save("experience", e.id, { org: v })}
                    wrapClass="org"
                  />
                  <BulletsField
                    bullets={e.bullets ?? []}
                    onSave={(bullets) => save("experience", e.id, { bullets })}
                  />
                </div>
              ))}
            </section>
          )}

          {/* education */}
          {data.education.length > 0 && (
            <section className="section">
              <h2>Education</h2>
              {data.education.map((ed) => (
                <div className="entry" key={ed.id}>
                  <div className="row">
                    <Field
                      className="f title"
                      value={ed.institution}
                      placeholder="Institution"
                      onSave={(v) => save("education", ed.id, { institution: v })}
                      wrapClass="title"
                    />
                    <DatesField
                      start={ed.startDate}
                      end={ed.endDate}
                      onSave={(patch) => save("education", ed.id, patch)}
                    />
                  </div>
                  <Field
                    className="f org"
                    value={[ed.degree, ed.field].filter(Boolean).join(", ")}
                    placeholder="Degree, Field"
                    onSave={(v) => save("education", ed.id, { degree: v })}
                    wrapClass="org"
                  />
                </div>
              ))}
            </section>
          )}

          {/* skills */}
          {data.skills.length > 0 && (
            <section className="section">
              <h2>Skills</h2>
              <div className="skills-list">
                {data.skills.map((s) => (
                  <span className="chip" key={s.id}>
                    <InlineField
                      value={s.name}
                      placeholder="skill"
                      onSave={(v) => save("skill", s.id, { name: v })}
                    />
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* projects */}
          {data.projects.length > 0 && (
            <section className="section">
              <h2>Projects</h2>
              {data.projects.map((pr) => (
                <div className="entry" key={pr.id}>
                  <Field
                    className="f title"
                    value={pr.name}
                    placeholder="Project"
                    onSave={(v) => save("project", pr.id, { name: v })}
                    wrapClass="title"
                  />
                  <BulletsField
                    bullets={pr.bullets ?? []}
                    onSave={(bullets) => save("project", pr.id, { bullets })}
                  />
                </div>
              ))}
            </section>
          )}
        </div>
      </main>
    </>
  );
}

// ---------- field primitives ----------

function Field({
  value,
  placeholder,
  onSave,
  className,
  wrapClass,
}: {
  value: string | null;
  placeholder?: string;
  onSave: (v: string) => void;
  className?: string;
  wrapClass?: string;
}) {
  const [v, setV] = useState(value ?? "");
  return (
    <div className={wrapClass}>
      <input
        className={className ?? "f"}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v !== (value ?? "")) onSave(v);
        }}
      />
    </div>
  );
}

function InlineField({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder?: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value ?? "");
  return (
    <input
      className="f"
      style={{ width: `${Math.max((v || placeholder || "").length, 4)}ch` }}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== (value ?? "")) onSave(v);
      }}
    />
  );
}

function DatesField({
  start,
  end,
  onSave,
}: {
  start: string | null;
  end: string | null;
  onSave: (patch: { startDate?: string; endDate?: string }) => void;
}) {
  const [s, setS] = useState(start ?? "");
  const [e, setE] = useState(end ?? "");
  return (
    <span className="dates">
      <input
        className="f dates-input"
        value={s}
        placeholder="start"
        onChange={(ev) => setS(ev.target.value)}
        onBlur={() => s !== (start ?? "") && onSave({ startDate: s })}
        style={{ width: "72px" }}
      />
      {" – "}
      <input
        className="f dates-input"
        value={e}
        placeholder="end"
        onChange={(ev) => setE(ev.target.value)}
        onBlur={() => e !== (end ?? "") && onSave({ endDate: e })}
        style={{ width: "72px" }}
      />
    </span>
  );
}

function BulletsField({
  bullets,
  onSave,
}: {
  bullets: Bullet[];
  onSave: (bullets: Bullet[]) => void;
}) {
  const initial = bullets.map((b) => b.text).join("\n");
  const [text, setText] = useState(initial);
  return (
    <textarea
      className="f bullets"
      rows={Math.max(text.split("\n").length, 1)}
      value={text}
      placeholder="• one achievement per line"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== initial) {
          const next = text
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => ({ text: t }));
          onSave(next);
        }
      }}
    />
  );
}
