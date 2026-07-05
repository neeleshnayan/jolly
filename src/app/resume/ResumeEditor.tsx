"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { RichBullets } from "./RichBullets";
import { SortableItem } from "./SortableItem";

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
  const [pages, setPages] = useState(1);
  const resumeRef = useRef<HTMLDivElement>(null);

  // measure how many A4 pages the content spans
  useEffect(() => {
    const el = resumeRef.current;
    if (!el) return;
    const PAGE = (297 * 96) / 25.4; // A4 height in px
    const measure = () => setPages(Math.max(1, Math.ceil(el.scrollHeight / PAGE)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // background probe generation (kicked off by the upload, runs on the server)
  const [probeStatus, setProbeStatus] = useState<"working" | "ready" | null>(null);
  const [probeCount, setProbeCount] = useState(0);

  useEffect(() => {
    let stop = false;
    let tries = 0;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/resume/probes?u=${userId}`);
        const j = await r.json();
        if (j.count > 0 && !j.generating) {
          setProbeCount(j.count);
          setProbeStatus("ready");
          return; // done — stop polling
        }
        setProbeStatus("working");
      } catch {
        /* keep trying */
      }
      if (!stop && tries++ < 40) setTimeout(tick, 3000);
      else if (!stop) setProbeStatus(null);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [userId]);

  // batched autosave: queue field edits, coalesce per entity, flush on a debounce
  const pendingRef = useRef<Map<string, { kind: string; id?: string; patch: Record<string, unknown> }>>(new Map());
  const flushTimer = useRef<number | undefined>(undefined);

  function save(kind: string, id: string | undefined, patch: object) {
    const key = `${kind}:${id ?? "profile"}`;
    const prev = pendingRef.current.get(key);
    pendingRef.current.set(key, {
      kind,
      id,
      patch: { ...(prev?.patch ?? {}), ...(patch as Record<string, unknown>) },
    });
    setStatus("Editing…");
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => void flush(), 1200);
  }

  async function flush() {
    window.clearTimeout(flushTimer.current);
    if (pendingRef.current.size === 0) return;
    const edits = [...pendingRef.current.values()];
    pendingRef.current.clear();
    setStatus("Saving…");
    try {
      const res = await fetch("/api/profile/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, edits }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStatus("Saved ✓");
      setTimeout(() => setStatus((s) => (s === "Saved ✓" ? "" : s)), 1500);
    } catch (err) {
      // re-queue so nothing is lost
      for (const e of edits) {
        const key = `${e.kind}:${e.id ?? "profile"}`;
        if (!pendingRef.current.has(key)) pendingRef.current.set(key, e);
      }
      setStatus(err instanceof Error ? err.message : "Save failed");
    }
  }

  // flush on leave: sendBeacon for a hard unload, plain flush for in-app nav
  useEffect(() => {
    const onLeave = () => {
      if (!pendingRef.current.size) return;
      const edits = [...pendingRef.current.values()];
      navigator.sendBeacon(
        "/api/profile/batch",
        new Blob([JSON.stringify({ userId, edits })], { type: "application/json" }),
      );
      pendingRef.current.clear();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type EntryKind = "experience" | "education" | "skill" | "project";

  async function addEntry(kind: EntryKind) {
    setStatus("Adding…");
    try {
      const res = await fetch("/api/profile/entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, kind, action: "create" }),
      });
      const json = await res.json();
      if (!json.id) throw new Error(json.error || "Add failed");
      const id = json.id as string;
      setData((d) => {
        if (kind === "experience")
          return { ...d, experiences: [...d.experiences, { id, org: null, title: null, location: null, startDate: null, endDate: null, isCurrent: false, bullets: [] }] };
        if (kind === "education")
          return { ...d, education: [...d.education, { id, institution: null, degree: null, field: null, startDate: null, endDate: null, details: null }] };
        if (kind === "skill") return { ...d, skills: [...d.skills, { id, name: "New skill", category: null }] };
        return { ...d, projects: [...d.projects, { id, name: null, description: null, bullets: [] }] };
      });
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Add failed");
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function persistOrder(kind: EntryKind, ids: string[]) {
    void fetch("/api/profile/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, kind, ids }),
    }).catch(() => setStatus("Reorder failed"));
  }
  function moveById<T extends { id: string }>(list: T[], from: string, to: string): T[] | null {
    const oi = list.findIndex((x) => x.id === from);
    const ni = list.findIndex((x) => x.id === to);
    return oi < 0 || ni < 0 ? null : arrayMove(list, oi, ni);
  }

  function reorder(kind: EntryKind, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = String(active.id);
    const to = String(over.id);
    setData((d) => {
      if (kind === "experience") {
        const m = moveById(d.experiences, from, to);
        if (!m) return d;
        persistOrder(kind, m.map((x) => x.id));
        return { ...d, experiences: m };
      }
      if (kind === "education") {
        const m = moveById(d.education, from, to);
        if (!m) return d;
        persistOrder(kind, m.map((x) => x.id));
        return { ...d, education: m };
      }
      if (kind === "project") {
        const m = moveById(d.projects, from, to);
        if (!m) return d;
        persistOrder(kind, m.map((x) => x.id));
        return { ...d, projects: m };
      }
      const m = moveById(d.skills, from, to);
      if (!m) return d;
      persistOrder(kind, m.map((x) => x.id));
      return { ...d, skills: m };
    });
  }

  function removeEntry(kind: EntryKind, id: string) {
    setData((d) => ({
      ...d,
      experiences: kind === "experience" ? d.experiences.filter((x) => x.id !== id) : d.experiences,
      education: kind === "education" ? d.education.filter((x) => x.id !== id) : d.education,
      skills: kind === "skill" ? d.skills.filter((x) => x.id !== id) : d.skills,
      projects: kind === "project" ? d.projects.filter((x) => x.id !== id) : d.projects,
    }));
    void fetch("/api/profile/entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, kind, action: "delete", id }),
    }).catch(() => setStatus("Delete failed"));
  }

  const p = data.profile;

  return (
    <>
      <div className="topbar no-print">
        <span className="brand">Career Co-Pilot</span>
        <span style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="status">{status}</span>
          <button
            className="ghost-btn"
            onClick={() => window.print()}
            title="Opens your browser's print dialog — choose “Save as PDF”"
          >
            Download PDF
          </button>
          <a href={`/mentor?u=${userId}`}>Talk to your mentor →</a>
        </span>
      </div>

      <main className="resume-wrap">
        {probeStatus === "working" && (
          <div className="probe-banner no-print">
            <span>Prepping your mentor with questions from your résumé…</span>
            <span className="bar" />
          </div>
        )}
        {probeStatus === "ready" && (
          <div className="probe-banner ready no-print">
            <span>
              ✓ Your mentor is prepped with {probeCount} question
              {probeCount === 1 ? "" : "s"} from your résumé —{" "}
              <a href={`/mentor?u=${userId}`}>start the call →</a>
            </span>
          </div>
        )}
        <div
          className="no-print"
          style={{
            maxWidth: 780,
            margin: "0 auto 16px",
            fontSize: 14,
            color: "var(--muted)",
          }}
        >
          Here&apos;s what we pulled from your résumé. <strong>Review and fix
          anything that&apos;s off</strong> — edits save automatically. Then
          download it as a PDF or talk to your mentor.
        </div>
        <div className="page-meta no-print">
          A4 · {pages} page{pages === 1 ? "" : "s"}
        </div>
        <div className="resume" ref={resumeRef}>
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
              <DndContext id="dnd-exp" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("experience", ev)}>
              <SortableContext items={data.experiences.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.experiences.map((e) => (
                <SortableItem id={e.id} key={e.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove role" onClick={() => removeEntry("experience", e.id)}>×</button>
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
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
              <button className="add-btn no-print" onClick={() => addEntry("experience")}>+ Add role</button>
            </section>
          )}

          {/* education */}
          {data.education.length > 0 && (
            <section className="section">
              <h2>Education</h2>
              <DndContext id="dnd-edu" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("education", ev)}>
              <SortableContext items={data.education.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.education.map((ed) => (
                <SortableItem id={ed.id} key={ed.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove" onClick={() => removeEntry("education", ed.id)}>×</button>
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
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
              <button className="add-btn no-print" onClick={() => addEntry("education")}>+ Add education</button>
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
                    <button className="chip-x no-print" title="Remove" onClick={() => removeEntry("skill", s.id)}>×</button>
                  </span>
                ))}
                <button className="chip add-chip no-print" onClick={() => addEntry("skill")}>+ Add</button>
              </div>
            </section>
          )}

          {/* projects */}
          {data.projects.length > 0 && (
            <section className="section">
              <h2>Projects</h2>
              <DndContext id="dnd-proj" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("project", ev)}>
              <SortableContext items={data.projects.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.projects.map((pr) => (
                <SortableItem id={pr.id} key={pr.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove" onClick={() => removeEntry("project", pr.id)}>×</button>
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
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
              <button className="add-btn no-print" onClick={() => addEntry("project")}>+ Add project</button>
            </section>
          )}

          {/* add any empty sections */}
          <div className="add-sections no-print">
            {data.experiences.length === 0 && <button onClick={() => addEntry("experience")}>+ Experience</button>}
            {data.education.length === 0 && <button onClick={() => addEntry("education")}>+ Education</button>}
            {data.skills.length === 0 && <button onClick={() => addEntry("skill")}>+ Skills</button>}
            {data.projects.length === 0 && <button onClick={() => addEntry("project")}>+ Projects</button>}
          </div>
        </div>

        <div
          className="no-print"
          style={{
            maxWidth: 780,
            margin: "24px auto 0",
            display: "flex",
            gap: 12,
            justifyContent: "center",
          }}
        >
          <button
            className="btn"
            style={{
              width: "auto",
              margin: 0,
              padding: "12px 28px",
              background: "transparent",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
            }}
            onClick={() => window.print()}
          >
            Download PDF
          </button>
          <a
            className="btn"
            style={{
              display: "inline-block",
              width: "auto",
              margin: 0,
              padding: "12px 28px",
              textDecoration: "none",
            }}
            href={`/mentor?u=${userId}`}
          >
            Looks good — talk to your mentor →
          </a>
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
      // +2ch buffer: `ch` is the width of "0", so wider glyphs (m, w, @) in a
      // proportional font would otherwise clip the last character.
      style={{ width: `${Math.max((v || placeholder || "").length + 2, 4)}ch` }}
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
  return (
    <RichBullets
      value={bulletsToHtml(bullets)}
      onSave={(html) => {
        const next = htmlToBullets(html);
        const before = bullets.map((b) => b.text).join("");
        const after = next.map((b) => b.text).join("");
        if (after !== before) onSave(next);
      }}
    />
  );
}

function bulletsToHtml(bullets: Bullet[]): string {
  if (!bullets?.length) return "";
  return `<ul>${bullets.map((b) => `<li>${b.text}</li>`).join("")}</ul>`;
}
function htmlToBullets(html: string): Bullet[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("li"))
    .map((li) => li.innerHTML.trim())
    .filter((t) => t && t !== "<br>")
    .map((text) => ({ text }));
}
