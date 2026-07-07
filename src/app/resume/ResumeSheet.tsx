"use client";

import type { CSSProperties } from "react";

// read-only shapes (a subset of the editor's data)
type Bullet = { text: string };
type Sheet = {
  profile: {
    fullName: string | null;
    headline: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    styleConfig?: Record<string, string | number> | null;
  };
  experiences: { id: string; org: string | null; title: string | null; location: string | null; startDate: string | null; endDate: string | null; bullets: Bullet[] | null }[];
  education: { id: string; institution: string | null; degree: string | null; field: string | null; location?: string | null; startDate: string | null; endDate: string | null; details?: string | null }[];
  skills: { id: string; name: string }[];
  projects: { id: string; name: string | null; description?: string | null; startDate?: string | null; endDate?: string | null; bullets: Bullet[] | null }[];
  certifications: { id: string; name: string | null; issuer: string | null; date: string | null }[];
};

const DEFAULT_STYLE = { nameScale: 1, headerScale: 1, bodyScale: 1, density: 1, accent: "#2563eb", fontFamily: "", template: "clean" };

function bulletsHtml(bullets: Bullet[] | null): string {
  if (!bullets?.length) return "";
  return `<ul>${bullets.map((b) => `<li>${b.text}</li>`).join("")}</ul>`;
}
function dates(a: string | null, b: string | null) {
  if (!a && !b) return null;
  return `${a ?? ""}${a && b ? " – " : ""}${b ?? ""}`;
}

/** A non-editable render of a résumé + its style tokens. Mirrors the editor's
 *  markup/classes so styleConfig applies identically. Used in the redesign diff. */
export default function ResumeSheet({ data }: { data: Sheet }) {
  const s = { ...DEFAULT_STYLE, ...(data.profile.styleConfig ?? {}) };
  const vars = {
    "--r-name-scale": s.nameScale,
    "--r-header-scale": s.headerScale,
    "--r-body-scale": s.bodyScale,
    "--r-density": s.density,
    "--r-accent": s.accent,
    "--r-font": s.fontFamily || "inherit",
  } as CSSProperties;
  const p = data.profile;

  return (
    <div className="resume ro" style={vars} data-template={String(s.template || "clean")}>
      <div className="name">{p.fullName}</div>
      {p.headline && <div className="headline">{p.headline}</div>}
      <div className="contact">
        {[p.email, p.phone, p.location].filter(Boolean).map((x, i) => (
          <span key={i}>{x}</span>
        ))}
      </div>

      {data.experiences.length > 0 && (
        <section className="section">
          <h2>Experience</h2>
          {data.experiences.map((e) => (
            <div className="entry" key={e.id}>
              <div className="row">
                <span className="title">{e.title}</span>
                {dates(e.startDate, e.endDate) && <span className="dates">{dates(e.startDate, e.endDate)}</span>}
              </div>
              <div className="org-line">
                <span className="org">{e.org}</span>
                {e.location && <span className="loc">{e.location}</span>}
              </div>
              <div className="ro-bullets" dangerouslySetInnerHTML={{ __html: bulletsHtml(e.bullets) }} />
            </div>
          ))}
        </section>
      )}

      {data.education.length > 0 && (
        <section className="section">
          <h2>Education</h2>
          {data.education.map((ed) => (
            <div className="entry" key={ed.id}>
              <div className="row">
                <span className="title">{ed.institution}</span>
                {dates(ed.startDate, ed.endDate) && <span className="dates">{dates(ed.startDate, ed.endDate)}</span>}
              </div>
              <div className="row">
                <span className="org">{[ed.degree, ed.field].filter(Boolean).join(", ")}</span>
                {ed.location && <span className="loc">{ed.location}</span>}
              </div>
              {ed.details && <div className="org">{ed.details}</div>}
            </div>
          ))}
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="section">
          <h2>Skills</h2>
          <div className="skills-list">
            {data.skills.map((sk) => (
              <span className="chip" key={sk.id}>{sk.name}</span>
            ))}
          </div>
        </section>
      )}

      {data.projects.length > 0 && (
        <section className="section">
          <h2>Projects</h2>
          {data.projects.map((pr) => (
            <div className="entry" key={pr.id}>
              <div className="row">
                <span className="title">{pr.name}</span>
                {dates(pr.startDate ?? null, pr.endDate ?? null) && (
                  <span className="dates">{dates(pr.startDate ?? null, pr.endDate ?? null)}</span>
                )}
              </div>
              {pr.description && <div className="org">{pr.description}</div>}
              <div className="ro-bullets" dangerouslySetInnerHTML={{ __html: bulletsHtml(pr.bullets) }} />
            </div>
          ))}
        </section>
      )}

      {data.certifications.length > 0 && (
        <section className="section">
          <h2>Certifications</h2>
          {data.certifications.map((c) => (
            <div className="entry" key={c.id}>
              <div className="row">
                <span className="title">{c.name}</span>
                {c.date && <span className="dates">{c.date}</span>}
              </div>
              {c.issuer && <div className="org">{c.issuer}</div>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
