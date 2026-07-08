"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { RichBullets } from "./RichBullets";
import { SortableItem } from "./SortableItem";
import VersionBar from "./VersionBar";
import ResumeSheet from "./ResumeSheet";
import UserChip from "../UserChip";
import Brand from "../Brand";

// ---- local shapes (avoid pulling drizzle into the client bundle) ----
type Link = { label: string; url: string };
type Bullet = { text: string; sourceId?: string };
type EntryKind = "experience" | "education" | "skill" | "project" | "certification";

// Design tokens applied to the sheet as CSS variables. This is the seam the AI
// "re-paint" agent will one day write to — for now humans nudge it via the
// Design panel. Missing keys fall back to DEFAULT_STYLE.
type StyleConfig = {
  nameScale: number;
  headerScale: number;
  bodyScale: number;
  density: number;
  bulletGap: number; // px between bullets within an entry
  accent: string;
  fontFamily: string;
  template: string; // clean | accent-name | ruled | serif-center (CSS-only layout variants)
};
const DEFAULT_STYLE: StyleConfig = {
  nameScale: 1,
  headerScale: 1,
  bodyScale: 1,
  density: 1,
  bulletGap: 3,
  accent: "#2563eb",
  fontFamily: "",
  template: "clean",
};

/** ATS score as a ring — the same number reads as progress, not a grade. */
function AtsRing({ score }: { score: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const cls = score >= 70 ? "good" : score >= 45 ? "mid" : "low";
  return (
    <svg className={`ats-ring ${cls}`} viewBox="0 0 60 60" width="60" height="60" role="img" aria-label={`${score}% keyword match`}>
      <circle className="ats-ring-track" cx="30" cy="30" r={r} />
      <circle className="ats-ring-fill" cx="30" cy="30" r={r} strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 30 30)" />
      <text x="30" y="35" textAnchor="middle" className="ats-ring-num">
        {score}%
      </text>
    </svg>
  );
}
const TEMPLATE_OPTIONS = [
  { key: "clean", label: "Clean", hint: "Understated, left-aligned — the safe default" },
  { key: "accent-name", label: "Accent", hint: "Your name in the accent color — modern & warm" },
  { key: "ruled", label: "Ruled", hint: "Bold accent rule up top — confident, graphic" },
  { key: "serif-center", label: "Centered", hint: "Centered header, hairline rules — formal" },
  { key: "banner", label: "Banner", hint: "Warm gradient header band — refined, memorable" },
  { key: "bold", label: "Bold", hint: "Oversized name, tinted section bars — impossible to skim past" },
  { key: "mono", label: "Mono", hint: "Dark header, monospace accents, code-tag skills — built for engineers" },
];
const FONT_OPTIONS = [
  { label: "Default (sans)", value: "" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Garamond", value: "Garamond, 'EB Garamond', Georgia, serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Calibri", value: "Calibri, 'Segoe UI', system-ui, sans-serif" },
  { label: "Helvetica", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
];

// One-tap looks — curated token bundles (Teal-style guide vibes). Each is a
// complete style so switching presets never leaves stale tokens behind.
const STYLE_PRESETS: { name: string; hint: string; style: StyleConfig }[] = [
  {
    name: "Classic",
    hint: "Centered serif, restrained — finance / consulting",
    style: { nameScale: 1.05, headerScale: 0.95, bodyScale: 1, density: 1.05, bulletGap: 4, accent: "#1f2937", fontFamily: "Georgia, 'Times New Roman', serif", template: "serif-center" },
  },
  {
    name: "Modern",
    hint: "Clean sans, blue accent — tech default",
    style: { nameScale: 1, headerScale: 1, bodyScale: 1, density: 1, bulletGap: 3, accent: "#2563eb", fontFamily: "", template: "clean" },
  },
  {
    name: "Teal",
    hint: "Teal name, warm & serious — the Teal look",
    style: { nameScale: 1.1, headerScale: 1, bodyScale: 0.97, density: 0.92, bulletGap: 3, accent: "#0f766e", fontFamily: "Calibri, 'Segoe UI', system-ui, sans-serif", template: "accent-name" },
  },
  {
    name: "Compact",
    hint: "Ruled dense one-pager — lots of experience, one page",
    style: { nameScale: 0.92, headerScale: 0.9, bodyScale: 0.92, density: 0.78, bulletGap: 1, accent: "#334155", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", template: "ruled" },
  },
];

// A live "edit with AI" session, anchored to one bulleted entry. `top` is its
// vertical offset within the sheet frame, so the compose box (left margin) and
// the suggestion card (right rail) line up with the entry they act on.
type AISession = {
  kind: EntryKind;
  id: string;
  top: number;
  bullets: string[];
  instruction: string;
  loading: boolean;
  proposed: string[] | null;
  err: string;
};

interface Profile {
  id: string;
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: Link[] | null;
  styleConfig?: Record<string, string | number> | null;
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
  location: string | null;
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
  startDate: string | null;
  endDate: string | null;
  bullets: Bullet[] | null;
}
interface Certification {
  id: string;
  name: string | null;
  issuer: string | null;
  date: string | null;
}
interface FullProfile {
  profile: Profile;
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
  projects: Project[];
  certifications: Certification[];
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
  const frameRef = useRef<HTMLDivElement>(null);

  // "edit with AI" session (compose on the left, preview on the right)
  const [ai, setAi] = useState<AISession | null>(null);
  const aiRef = useRef<AISession | null>(null);
  aiRef.current = ai;

  // the printed PDF's header (and saved filename) use the document title — set it
  // to the person's name so it isn't the app name
  useEffect(() => {
    const prev = document.title;
    document.title = (data.profile.fullName || "Resume").trim();
    return () => {
      document.title = prev;
    };
  }, [data.profile.fullName]);

  // design tokens (merged over defaults so old profiles just work)
  const style: StyleConfig = { ...DEFAULT_STYLE, ...(data.profile.styleConfig ?? {}) };
  function setStyle(patch: Partial<StyleConfig>) {
    const next = { ...style, ...patch };
    setData((d) => ({ ...d, profile: { ...d.profile, styleConfig: next } }));
    save("profile", undefined, { styleConfig: next });
  }

  // AI overhaul: redesigns BOTH look (styleConfig) and content (bullets), then
  // shows a side-by-side diff (current vs proposed) to accept or discard.
  type Overhaul = {
    style: StyleConfig;
    rationale: string;
    content: { experiences: { id: string; bullets: string[] }[]; projects: { id: string; bullets: string[] }[] };
    proposed: FullProfile;
  };
  const [overhaul, setOverhaul] = useState<Overhaul | null>(null);
  const [redesigning, setRedesigning] = useState(false);
  const [redesignErr, setRedesignErr] = useState("");
  // the mentor's recommended target role (from the filled TBD theme), if any
  const [targetRole, setTargetRole] = useState<{ role: string; rationale: string } | null>(null);
  const [targetOpen, setTargetOpen] = useState(false);
  // mentor tips — résumé-worthy facts mined from the latest call transcript
  type Tip = {
    id: string | null;
    kind: "bullet" | "skill";
    text: string;
    entryKind: "experience" | "project" | null;
    entryId: string | null;
    entryLabel: string | null;
    applied?: boolean;
  };
  const [tips, setTips] = useState<Tip[] | null>(null);
  const [tipsState, setTipsState] = useState<"idle" | "loading" | "none" | "error">("idle");
  // "target a job" — paste a JD, get a tailored cover letter and/or a tailored redesign
  const [jobOpen, setJobOpen] = useState(false);
  const [jd, setJd] = useState("");
  const [letter, setLetter] = useState<{ text: string; hooks: string[] } | null>(null);
  const [letterBusy, setLetterBusy] = useState(false);
  const [letterErr, setLetterErr] = useState("");
  // ATS keyword screen: JD keywords vs the résumé, matched deterministically
  type AtsResult = { score: number; required: { term: string; hit: boolean }[]; preferred: { term: string; hit: boolean }[] };
  const [ats, setAts] = useState<AtsResult | null>(null);
  const [atsBusy, setAtsBusy] = useState(false);
  // previous run for THIS JD (localStorage) — the before/after is the payoff
  // of the weave→re-check loop, so it must survive reloads
  const [atsPrev, setAtsPrev] = useState<{ score: number; at: number } | null>(null);
  const atsRunKey = (jdText: string) => {
    let h = 5381;
    for (const ch of jdText.trim().toLowerCase()) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    return `drizzle:ats:${userId.slice(0, 8)}:${h.toString(36)}`;
  };
  // the cover letter is a first-class document beside the résumé: same theme,
  // its own version history (cover_letters table)
  const [docTab, setDocTab] = useState<"resume" | "letter">("resume");
  const [letterText, setLetterText] = useState("");
  const [letterVersions, setLetterVersions] = useState<{ id: string; label: string | null; content: string; createdAt: string }[]>([]);
  const [letterSaving, setLetterSaving] = useState(false);
  useEffect(() => {
    fetch(`/api/cover-letters?u=${userId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setLetterVersions(j.versions ?? []);
        if (j.versions?.[0]) setLetterText((cur) => cur || j.versions[0].content);
      })
      .catch(() => {});
  }, [userId]);
  async function saveLetterVersion() {
    if (letterText.trim().length < 40) return;
    setLetterSaving(true);
    try {
      const label = jd.trim() ? jd.trim().split("\n")[0].slice(0, 60) : `Draft ${new Date().toLocaleDateString()}`;
      const r = await fetch("/api/cover-letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, content: letterText, label, jd: jd.trim() || undefined }),
      });
      const j = await r.json();
      if (r.ok) setLetterVersions((v) => [{ id: j.id, label, content: letterText, createdAt: new Date().toISOString() }, ...v]);
    } finally {
      setLetterSaving(false);
    }
  }
  const [letterPdfBusy, setLetterPdfBusy] = useState(false);
  async function downloadLetterPdf() {
    setLetterPdfBusy(true);
    try {
      const r = await fetch("/api/cover-letters/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ u: userId, content: letterText }),
      });
      if (!r.ok) return;
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(data.profile.fullName || "cover-letter").trim().replace(/\s+/g, "-")}-cover-letter.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setLetterPdfBusy(false);
    }
  }
  function downloadLetterText() {
    const blob = new Blob([letterText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(data.profile.fullName || "cover-letter").trim().replace(/\s+/g, "-")}-cover-letter.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function checkAts() {
    setAtsBusy(true);
    setLetterErr("");
    try {
      const r = await fetch("/api/resume/ats-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, jd }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Check failed");
      setAts(j);
      try {
        const key = atsRunKey(jd);
        setAtsPrev(JSON.parse(localStorage.getItem(key) ?? "null"));
        localStorage.setItem(key, JSON.stringify({ score: j.score, at: Date.now() }));
      } catch {
        setAtsPrev(null);
      }
    } catch (e) {
      setLetterErr(e instanceof Error ? e.message : "Check failed");
    } finally {
      setAtsBusy(false);
    }
  }
  async function generateLetter() {
    setLetterBusy(true);
    setLetterErr("");
    try {
      const r = await fetch("/api/resume/cover-letter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...(jd.trim() ? { jd: jd.trim() } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't write the letter");
      // on the cover-letter tab, write straight into the document; the modal
      // is only for quick generation while working on the résumé
      if (docTab === "letter") {
        setLetterText(j.letter);
      } else {
        setLetter({ text: j.letter, hooks: j.hooks ?? [] });
      }
    } catch (e) {
      setLetterErr(e instanceof Error ? e.message : "Couldn't write the letter");
    } finally {
      setLetterBusy(false);
    }
  }
  function downloadLetter() {
    if (!letter) return;
    const blob = new Blob([letter.text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(data.profile.fullName || "cover-letter").trim().replace(/\s+/g, "-")}-cover-letter.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function loadTips() {
    setTipsState("loading");
    try {
      const r = await fetch(`/api/resume/suggest?u=${userId}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.noCall || !(j.suggestions ?? []).length) {
        setTips([]);
        setTipsState("none");
      } else {
        setTips(j.suggestions);
        setTipsState("idle");
      }
    } catch {
      setTipsState("error");
    }
  }
  async function applyTip(i: number) {
    const t = tips?.[i];
    if (!t || t.applied) return;
    try {
      const r = await fetch("/api/resume/suggest/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          kind: t.kind,
          entryKind: t.entryKind ?? undefined,
          entryId: t.entryId ?? undefined,
          text: t.text,
          suggestionId: t.id ?? undefined,
        }),
      });
      if (!r.ok) throw new Error();
      setTips((cur) => cur?.map((x, idx) => (idx === i ? { ...x, applied: true } : x)) ?? null);
      await reloadData(); // the new bullet/skill shows up in the sheet
    } catch {
      /* leave un-applied; user can retry */
    }
  }
  useEffect(() => {
    fetch(`/api/track/version?u=${userId}`)
      .then((r) => r.json())
      .then((j) => {
        const t = (j.themes ?? []).find(
          (x: { latentAttributes?: { kind?: string; role?: string } }) => x.latentAttributes?.kind === "target_role" && x.latentAttributes?.role,
        );
        if (t) setTargetRole({ role: t.latentAttributes.role, rationale: t.latentAttributes.rationale ?? "" });
      })
      .catch(() => {});
  }, [userId]);
  const wrapBullets = (arr: string[]) => arr.map((t) => ({ text: `<p>${t}</p>` }));
  async function redesign(jd?: string, onlyKeywords?: string[]) {
    setRedesigning(true);
    setRedesignErr("");
    try {
      // the ATS check's missing keywords feed the rewrite: rephrase what's
      // truthfully there into the JD's vocabulary (never invent). A chip's ✎
      // narrows the rewrite to that one term.
      const missing = onlyKeywords ?? (ats ? [...ats.required, ...ats.preferred].filter((k) => !k.hit).map((k) => k.term) : []);
      const res = await fetch("/api/resume/redesign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          ...(jd?.trim() ? { jd: jd.trim() } : {}),
          ...(jd?.trim() && missing.length ? { missingKeywords: missing.slice(0, 20) } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Redesign failed");
      const style = { ...DEFAULT_STYLE, ...j.styleConfig };
      const content = j.content ?? { experiences: [], projects: [] };
      const em = new Map<string, string[]>(content.experiences.map((c: { id: string; bullets: string[] }) => [c.id, c.bullets]));
      const pm = new Map<string, string[]>(content.projects.map((c: { id: string; bullets: string[] }) => [c.id, c.bullets]));
      const proposed: FullProfile = {
        ...data,
        profile: { ...data.profile, styleConfig: style },
        experiences: data.experiences.map((e) => (em.has(e.id) ? { ...e, bullets: wrapBullets(em.get(e.id)!) } : e)),
        projects: data.projects.map((p) => (pm.has(p.id) ? { ...p, bullets: wrapBullets(pm.get(p.id)!) } : p)),
      };
      setOverhaul({ style, rationale: j.rationale ?? "", content, proposed });
    } catch (e) {
      setRedesignErr(e instanceof Error ? e.message : "Redesign failed");
    } finally {
      setRedesigning(false);
    }
  }
  function applyOverhaul() {
    const o = overhaul;
    if (!o) return;
    setData(o.proposed);
    save("profile", undefined, { styleConfig: o.style });
    o.content.experiences.forEach((c) => save("experience", c.id, { bullets: wrapBullets(c.bullets) }));
    o.content.projects.forEach((c) => save("project", c.id, { bullets: wrapBullets(c.bullets) }));
  }
  function overwriteOverhaul() {
    applyOverhaul();
    setOverhaul(null);
  }
  function saveOverhaulAsNew() {
    applyOverhaul();
    setOverhaul(null);
    void openSaveVersion();
  }

  // clean PDF: server-side puppeteer render (no browser date/URL headers)
  const [pdfBusy, setPdfBusy] = useState(false);
  async function downloadPdf() {
    setPdfBusy(true);
    setStatus("Building your PDF…");
    try {
      await flush(); // make sure the latest edits are in the PDF
      const res = await fetch(`/api/resume/pdf?u=${userId}`);
      if (!res.ok) throw new Error("PDF failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(data.profile.fullName || "resume").replace(/\s+/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("");
    } catch {
      setStatus("PDF failed — try again");
    } finally {
      setPdfBusy(false);
    }
  }

  // save-as-version (snapshot the résumé under a theme with a hypothesis)
  const [showSave, setShowSave] = useState(false);
  const [themes, setThemes] = useState<{ id: string; name: string }[]>([]);
  const [saveForm, setSaveForm] = useState({ themeId: "", newTheme: "", hypothesis: "" });
  const [saveVerMsg, setSaveVerMsg] = useState("");
  const [savingVer, setSavingVer] = useState(false);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  async function openSaveVersion() {
    setShowSave(true);
    setSaveVerMsg("");
    try {
      const r = await fetch(`/api/track/theme?u=${userId}`);
      const j = await r.json();
      if (r.ok) setThemes(j.themes ?? []);
    } catch {
      /* non-fatal */
    }
  }
  async function saveVersion() {
    setSavingVer(true);
    setSaveVerMsg("Saving…");
    try {
      await flush(); // make sure the latest edits are persisted before snapshotting
      let themeId = saveForm.themeId || undefined;
      if (!themeId && saveForm.newTheme.trim()) {
        const tr = await fetch("/api/track/theme", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, name: saveForm.newTheme.trim() }),
        });
        const tj = await tr.json();
        if (!tr.ok) throw new Error(tj.error || "Theme failed");
        themeId = tj.theme.id;
      }
      const res = await fetch("/api/track/version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, themeId, hypothesis: saveForm.hypothesis || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      setSaveVerMsg("Saved ✓ — now in your version dropdown & dashboard");
      setSaveForm({ themeId: "", newTheme: "", hypothesis: "" });
      setVersionRefreshKey((k) => k + 1); // refresh the version dropdown
    } catch (e) {
      setSaveVerMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingVer(false);
    }
  }

  const sheetVars = {
    "--r-name-scale": style.nameScale,
    "--r-header-scale": style.headerScale,
    "--r-body-scale": style.bodyScale,
    "--r-density": style.density,
    "--r-bullet-gap": `${style.bulletGap ?? 3}px`,
    "--r-accent": style.accent,
    "--r-font": style.fontFamily || "inherit",
  } as CSSProperties;

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
        if (j.count > 0) {
          setProbeCount(j.count);
          setProbeStatus("ready");
          return; // already prepped — no more polling
        }
        if (!j.generating) {
          // nothing to prep and nothing running (e.g. no probes for this résumé)
          setProbeStatus(null);
          return; // don't imply work that isn't happening
        }
        setProbeStatus("working"); // only while a run is actually in flight
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
          return { ...d, education: [...d.education, { id, institution: null, degree: null, field: null, location: null, startDate: null, endDate: null, details: null }] };
        if (kind === "skill") return { ...d, skills: [...d.skills, { id, name: "New skill", category: null }] };
        if (kind === "certification")
          return { ...d, certifications: [...d.certifications, { id, name: null, issuer: null, date: null }] };
        return { ...d, projects: [...d.projects, { id, name: null, description: null, startDate: null, endDate: null, bullets: [] }] };
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
      if (kind === "certification") {
        const m = moveById(d.certifications, from, to);
        if (!m) return d;
        persistOrder(kind, m.map((x) => x.id));
        return { ...d, certifications: m };
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
      certifications: kind === "certification" ? d.certifications.filter((x) => x.id !== id) : d.certifications,
    }));
    void fetch("/api/profile/entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, kind, action: "delete", id }),
    }).catch(() => setStatus("Delete failed"));
  }

  function entryIds(kind: EntryKind): string[] {
    if (kind === "experience") return data.experiences.map((x) => x.id);
    if (kind === "education") return data.education.map((x) => x.id);
    if (kind === "skill") return data.skills.map((x) => x.id);
    if (kind === "certification") return data.certifications.map((x) => x.id);
    return data.projects.map((x) => x.id);
  }
  function removeSection(kind: EntryKind, label: string) {
    const ids = entryIds(kind);
    if (!ids.length) return;
    if (!window.confirm(`Remove the entire ${label} section? This deletes ${ids.length} item${ids.length === 1 ? "" : "s"}.`)) return;
    ids.forEach((id) => removeEntry(kind, id));
  }

  // ---- edit-with-AI: open (measure the entry's position), refine, accept ----
  function openAI(kind: EntryKind, id: string, bullets: Bullet[], btn: HTMLElement) {
    const frame = frameRef.current;
    const entry = btn.closest(".entry") as HTMLElement | null;
    const top =
      frame && entry
        ? entry.getBoundingClientRect().top - frame.getBoundingClientRect().top
        : 0;
    setAi({
      kind,
      id,
      top,
      bullets: bullets.map((b) => stripTags(b.text)).filter(Boolean),
      instruction: "",
      loading: false,
      proposed: null,
      err: "",
    });
  }
  async function runAI() {
    const a = aiRef.current;
    if (!a || !a.instruction.trim() || !a.bullets.length) return;
    setAi({ ...a, loading: true, err: "" });
    try {
      const res = await fetch("/api/resume/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: a.instruction, bullets: a.bullets, userId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Refine failed");
      const cur = aiRef.current;
      if (cur) setAi({ ...cur, loading: false, proposed: j.bullets ?? [] });
    } catch (e) {
      const cur = aiRef.current;
      if (cur) setAi({ ...cur, loading: false, err: e instanceof Error ? e.message : "Refine failed" });
    }
  }
  // refresh the whole editor from the server (after a version restore) without a
  // full page reload, so the VersionBar keeps its selection
  async function reloadData() {
    try {
      const r = await fetch(`/api/profile/full?u=${userId}`);
      const j = await r.json();
      if (r.ok && j.profile) setData(j);
    } catch {
      /* non-fatal */
    }
  }

  function acceptAI() {
    const a = aiRef.current;
    if (!a || !a.proposed) return;
    const bullets = a.proposed.map((text) => ({ text }));
    setData((d) => {
      if (a.kind === "experience")
        return { ...d, experiences: d.experiences.map((e) => (e.id === a.id ? { ...e, bullets } : e)) };
      if (a.kind === "project")
        return { ...d, projects: d.projects.map((pr) => (pr.id === a.id ? { ...pr, bullets } : pr)) };
      return d;
    });
    save(a.kind, a.id, { bullets });
    setAi(null);
  }

  const p = data.profile;
  const isEmpty =
    !data.experiences.length &&
    !data.education.length &&
    !data.skills.length &&
    !data.projects.length &&
    !data.certifications.length;

  return (
    <>
      {/* lean topbar: the brand IS the way back, PDF lives with the sheet */}
      <div className="topbar no-print">
        <Brand />
        <span style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="status">{status}</span>
          <a href="/mentor">Talk to your mentor →</a>
          <UserChip />
        </span>
      </div>

      <VersionBar
        userId={userId}
        refreshKey={versionRefreshKey}
        onSaveVersion={openSaveVersion}
        onAfterRestore={reloadData}
      />

      {/* one workspace, two documents — same theme, separate version histories */}
      <div className="doc-tabs no-print">
        <button className={`doc-tab${docTab === "resume" ? " active" : ""}`} onClick={() => setDocTab("resume")}>
          📄 Résumé
        </button>
        <button className={`doc-tab${docTab === "letter" ? " active" : ""}`} onClick={() => setDocTab("letter")}>
          ✉ Cover letter{letterVersions.length ? ` (${letterVersions.length})` : ""}
        </button>
      </div>

      {redesigning && (
        <div className="diff-overlay no-print">
          <div className="diff-loading">
            ✨ Redesigning your résumé — revamping the look and sharpening the wording. This takes a minute…
          </div>
        </div>
      )}
      {overhaul && (
        <div className="diff-overlay no-print">
          <div className="diff-head">
            <div>
              <div className="diff-title">✨ AI redesign — review side by side</div>
              {overhaul.rationale && <div className="diff-rationale">{overhaul.rationale}</div>}
            </div>
            <div className="diff-actions">
              <button className="ghost-btn" onClick={() => setOverhaul(null)}>Keep original</button>
              <button className="btn-primary" onClick={overwriteOverhaul}>Overwrite my résumé</button>
              <button className="vb-btn primary" onClick={saveOverhaulAsNew}>Save as new version</button>
            </div>
          </div>
          <div className="diff-sheets">
            <div className="diff-col">
              <div className="diff-label">Current</div>
              <ResumeSheet data={data} />
            </div>
            <div className="diff-col">
              <div className="diff-label proposed">Proposed</div>
              <ResumeSheet data={overhaul.proposed} />
            </div>
          </div>
        </div>
      )}

      <div className="editor-shell">
        <aside className="editor-rail no-print">
          {/* section-adding only makes sense on the résumé doc — on the letter
              tab these buttons would edit a document you can't see */}
          {docTab === "resume" && (
            <div className="rail-group">
              <div className="rail-title">Add to résumé</div>
              <div className="rail-adds">
                <button className="rail-add" onClick={() => addEntry("experience")}>+ Experience</button>
                <button className="rail-add" onClick={() => addEntry("education")}>+ Education</button>
                <button className="rail-add" onClick={() => addEntry("skill")}>+ Skill</button>
                <button className="rail-add" onClick={() => addEntry("project")}>+ Project</button>
                <button className="rail-add" onClick={() => addEntry("certification")}>+ Cert</button>
              </div>
            </div>
          )}

          <div className="rail-group">
            <div className="rail-title">Design</div>
            <div className="preset-row">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  className={`preset-chip${style.accent === p.style.accent && style.fontFamily === p.style.fontFamily ? " active" : ""}`}
                  onClick={() => setStyle(p.style)}
                  title={p.hint}
                >
                  <span className="preset-dot" style={{ background: p.style.accent }} />
                  {p.name}
                </button>
              ))}
            </div>
            <Stepper label="Name size" value={style.nameScale} onChange={(v) => setStyle({ nameScale: v })} />
            <Stepper label="Headings" value={style.headerScale} onChange={(v) => setStyle({ headerScale: v })} />
            <Stepper label="Body text" value={style.bodyScale} onChange={(v) => setStyle({ bodyScale: v })} />
            <Stepper label="Spacing" value={style.density} min={0.5} max={1.5} onChange={(v) => setStyle({ density: v })} />
            <Stepper
              label="Bullet gap"
              value={style.bulletGap ?? 3}
              min={0}
              max={12}
              step={1}
              fmt={(v) => `${v}px`}
              onChange={(v) => setStyle({ bulletGap: Math.round(v) })}
            />
            <div className="design-row">
              <span>Accent</span>
              <input
                type="color"
                className="design-color"
                value={style.accent}
                onChange={(e) => setStyle({ accent: e.target.value })}
              />
            </div>
            <div className="design-row">
              <span>Font</span>
              <select
                className="design-font"
                value={style.fontFamily}
                onChange={(e) => setStyle({ fontFamily: e.target.value })}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.label} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="rail-subtitle">Template</div>
            <div className="preset-row">
              {TEMPLATE_OPTIONS.map((t) => (
                <button
                  key={t.key}
                  className={`preset-chip${style.template === t.key ? " active" : ""}`}
                  onClick={() => setStyle({ template: t.key })}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button className="design-reset" onClick={() => setStyle(DEFAULT_STYLE)}>Reset to default</button>
          </div>
        </aside>

        <div className="editor-canvas">
      <main className={`resume-wrap${docTab === "letter" ? " show-letter" : ""}`}>
        {letter && (
          <div className="save-modal-backdrop no-print" onClick={() => setLetter(null)}>
            <div className="save-modal letter-modal" onClick={(e) => e.stopPropagation()}>
              <div className="design-head">
                <span>Your cover letter</span>
                <button className="design-close" onClick={() => setLetter(null)}>×</button>
              </div>
              {letter.hooks.length > 0 && (
                <div className="letter-hooks">
                  {letter.hooks.map((h, i) => (
                    <span className="rec-chip good" key={i}>{h}</span>
                  ))}
                </div>
              )}
              <pre className="letter-body">{letter.text}</pre>
              <div className="letter-actions">
                <button className="btn-primary" onClick={() => void navigator.clipboard.writeText(letter.text)}>
                  Copy
                </button>
                <button className="refine-toggle" onClick={downloadLetter}>Download .txt</button>
                <button className="refine-toggle" onClick={() => void generateLetter()} disabled={letterBusy}>
                  {letterBusy ? "Rewriting…" : "↻ Rewrite"}
                </button>
              </div>
            </div>
          </div>
        )}
        {showSave && (
          <div className="save-modal-backdrop no-print" onClick={() => setShowSave(false)}>
            <div className="save-modal" onClick={(e) => e.stopPropagation()}>
              <div className="design-head">
                <span>Save this résumé as a version</span>
                <button className="design-close" onClick={() => setShowSave(false)}>×</button>
              </div>
              <label className="save-label">Theme</label>
              <select
                className="f-box"
                value={saveForm.themeId}
                onChange={(e) => setSaveForm((f) => ({ ...f, themeId: e.target.value }))}
              >
                <option value="">— pick a theme —</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {!saveForm.themeId && (
                <input
                  className="f-box"
                  value={saveForm.newTheme}
                  placeholder="…or type a new theme (Quant, Founder, PM, AI)"
                  onChange={(e) => setSaveForm((f) => ({ ...f, newTheme: e.target.value }))}
                />
              )}
              <label className="save-label">Hypothesis — what is this version betting on?</label>
              <textarea
                className="f-box"
                rows={3}
                value={saveForm.hypothesis}
                placeholder="e.g. Leading with founder/0-to-1 wins to land early-stage eng roles"
                onChange={(e) => setSaveForm((f) => ({ ...f, hypothesis: e.target.value }))}
              />
              <div className="save-actions">
                <button className="btn-primary" onClick={saveVersion} disabled={savingVer}>
                  {savingVer ? "Saving…" : "Save version"}
                </button>
                <a className="ghost-btn" href="/dashboard">View dashboard →</a>
                {saveVerMsg && <span className="dash-hint">{saveVerMsg}</span>}
              </div>
            </div>
          </div>
        )}
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
              <a href="/mentor">start the call →</a>
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
          {isEmpty ? (
            <>
              <strong>Build your résumé.</strong> Fill in your name and headline
              above, then add sections from the left panel. Everything saves
              automatically and you can restyle the whole sheet from Design.
            </>
          ) : (
            <>
              <strong>Edit and refine.</strong> Fix anything that&apos;s off, add
              sections from the left, restyle from Design — edits save
              automatically. Then download a PDF or talk to your mentor.
            </>
          )}
        </div>
        {docTab === "letter" && (
          <div className="sheet-frame letter-frame">
            <div className="letter-bar no-print">
              <select
                className="design-font"
                value=""
                onChange={(e) => {
                  const v = letterVersions.find((x) => x.id === e.target.value);
                  if (v) setLetterText(v.content);
                }}
              >
                <option value="" disabled>
                  {letterVersions.length ? `Load a version (${letterVersions.length})…` : "No saved versions yet"}
                </option>
                {letterVersions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label ?? "Draft"} · {new Date(v.createdAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
              <button className="ghost-btn" onClick={() => void generateLetter()} disabled={letterBusy}>
                {letterBusy ? "Writing…" : letterText ? "↻ Regenerate" : "✨ Generate"}
              </button>
              <button className="ghost-btn" onClick={downloadLetterText} disabled={!letterText.trim()}>↓ .txt</button>
              <button className="ghost-btn" onClick={() => void downloadLetterPdf()} disabled={letterPdfBusy || !letterText.trim()}>
                {letterPdfBusy ? "Rendering…" : "↓ PDF"}
              </button>
              <button className="btn-primary" onClick={() => void saveLetterVersion()} disabled={letterSaving || letterText.trim().length < 40}>
                {letterSaving ? "Saving…" : "+ Save as version"}
              </button>
            </div>
            <div className="resume letter-sheet" style={sheetVars} data-template={style.template || "clean"}>
              <div className="name">{p.fullName}</div>
              <div className="contact">
                {[p.email, p.phone, p.location].filter(Boolean).map((x, i) => (
                  <span key={i}>{x}</span>
                ))}
              </div>
              <textarea
                className="letter-edit"
                value={letterText}
                onChange={(e) => setLetterText(e.target.value)}
                placeholder={
                  "Dear Hiring Manager…\n\nWrite here, or paste a job description under 🎯 Target a job (right rail) and hit ✨ Generate — the letter is built from your résumé and what your mentor knows about you."
                }
              />
            </div>
          </div>
        )}
        <div className="page-meta no-print">
          A4 · {pages} page{pages === 1 ? "" : "s"}
        </div>
        <div className="sheet-frame" ref={frameRef}>
        <div className="resume" ref={resumeRef} style={sheetVars} data-template={style.template || "clean"}>
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
              <button className="section-x no-print" title="Remove Experience section" onClick={() => removeSection("experience", "Experience")}>×</button>
              <h2>Experience</h2>
              <DndContext id="dnd-exp" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("experience", ev)}>
              <SortableContext items={data.experiences.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.experiences.map((e) => (
                <SortableItem id={e.id} key={e.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove role" onClick={() => removeEntry("experience", e.id)}>×</button>
                  <button className="ai-trigger no-print" title="Edit with AI" onClick={(ev) => openAI("experience", e.id, e.bullets ?? [], ev.currentTarget)}>✨</button>
                  <EntryGear
                    fields={[
                      { label: "Location", value: e.location, placeholder: "e.g. Bengaluru, India", onSave: (v) => save("experience", e.id, { location: v }) },
                      { label: "Start", value: e.startDate, placeholder: "e.g. Jul 2025", onSave: (v) => save("experience", e.id, { startDate: v }) },
                      { label: "End", value: e.endDate, placeholder: "e.g. Present", onSave: (v) => save("experience", e.id, { endDate: v }) },
                    ]}
                  />
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
                  <div className="org-line">
                    <Field
                      className="f org"
                      value={e.org}
                      placeholder="Organization"
                      onSave={(v) => save("experience", e.id, { org: v })}
                      wrapClass="org"
                    />
                    <span className="loc">
                      <InlineField
                        value={e.location}
                        placeholder="+ location"
                        onSave={(v) => save("experience", e.id, { location: v })}
                      />
                    </span>
                  </div>
                  <BulletsField
                    bullets={e.bullets ?? []}
                    onSave={(bullets) => save("experience", e.id, { bullets })}
                  />
                </div>
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
            </section>
          )}

          {/* education */}
          {data.education.length > 0 && (
            <section className="section">
              <button className="section-x no-print" title="Remove Education section" onClick={() => removeSection("education", "Education")}>×</button>
              <h2>Education</h2>
              <DndContext id="dnd-edu" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("education", ev)}>
              <SortableContext items={data.education.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.education.map((ed) => (
                <SortableItem id={ed.id} key={ed.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove" onClick={() => removeEntry("education", ed.id)}>×</button>
                  <EntryGear
                    fields={[
                      { label: "Location", value: ed.location, placeholder: "e.g. Manipal, India", onSave: (v) => save("education", ed.id, { location: v }) },
                      { label: "Start", value: ed.startDate, placeholder: "e.g. Sep 2015", onSave: (v) => save("education", ed.id, { startDate: v }) },
                      { label: "End", value: ed.endDate, placeholder: "e.g. Jun 2019", onSave: (v) => save("education", ed.id, { endDate: v }) },
                      { label: "Details", value: ed.details, placeholder: "GPA, honors, thesis…", onSave: (v) => save("education", ed.id, { details: v }) },
                    ]}
                  />
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
                  <div className="row">
                    <Field
                      className="f org"
                      value={[ed.degree, ed.field].filter(Boolean).join(", ")}
                      placeholder="Degree, Field"
                      onSave={(v) => save("education", ed.id, { degree: v })}
                      wrapClass="org"
                    />
                    {ed.location && <span className="loc">{ed.location}</span>}
                  </div>
                  {ed.details && (
                    <Field
                      className="f org"
                      value={ed.details}
                      placeholder="Details"
                      onSave={(v) => save("education", ed.id, { details: v })}
                      wrapClass="org"
                    />
                  )}
                </div>
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
            </section>
          )}

          {/* skills */}
          {data.skills.length > 0 && (
            <section className="section">
              <button className="section-x no-print" title="Remove Skills section" onClick={() => removeSection("skill", "Skills")}>×</button>
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
              <button className="section-x no-print" title="Remove Projects section" onClick={() => removeSection("project", "Projects")}>×</button>
              <h2>Projects</h2>
              <DndContext id="dnd-proj" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("project", ev)}>
              <SortableContext items={data.projects.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.projects.map((pr) => (
                <SortableItem id={pr.id} key={pr.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove" onClick={() => removeEntry("project", pr.id)}>×</button>
                  <button className="ai-trigger no-print" title="Edit with AI" onClick={(ev) => openAI("project", pr.id, pr.bullets ?? [], ev.currentTarget)}>✨</button>
                  <EntryGear
                    fields={[
                      { label: "Start", value: pr.startDate, placeholder: "e.g. Jan 2018", onSave: (v) => save("project", pr.id, { startDate: v }) },
                      { label: "End", value: pr.endDate, placeholder: "e.g. Dec 2019", onSave: (v) => save("project", pr.id, { endDate: v }) },
                      { label: "Subtitle", value: pr.description, placeholder: "e.g. Founder · autonomous drone for emergencies", onSave: (v) => save("project", pr.id, { description: v }) },
                    ]}
                  />
                  <div className="row">
                    <Field
                      className="f title"
                      value={pr.name}
                      placeholder="Project"
                      onSave={(v) => save("project", pr.id, { name: v })}
                      wrapClass="title"
                    />
                    {(pr.startDate || pr.endDate) && (
                      <DatesField
                        start={pr.startDate}
                        end={pr.endDate}
                        onSave={(patch) => save("project", pr.id, patch)}
                      />
                    )}
                  </div>
                  {pr.description && (
                    <Field
                      className="f org"
                      value={pr.description}
                      placeholder="Subtitle"
                      onSave={(v) => save("project", pr.id, { description: v })}
                      wrapClass="org"
                    />
                  )}
                  <BulletsField
                    bullets={pr.bullets ?? []}
                    onSave={(bullets) => save("project", pr.id, { bullets })}
                  />
                </div>
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
            </section>
          )}

          {/* certifications */}
          {data.certifications.length > 0 && (
            <section className="section">
              <button className="section-x no-print" title="Remove Certifications section" onClick={() => removeSection("certification", "Certifications")}>×</button>
              <h2>Certifications</h2>
              <DndContext id="dnd-cert" sensors={sensors} collisionDetection={closestCenter} onDragEnd={(ev) => reorder("certification", ev)}>
              <SortableContext items={data.certifications.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              {data.certifications.map((c) => (
                <SortableItem id={c.id} key={c.id}>
                <div className="entry">
                  <button className="entry-x no-print" title="Remove" onClick={() => removeEntry("certification", c.id)}>×</button>
                  <EntryGear
                    fields={[
                      { label: "Issuer", value: c.issuer, placeholder: "e.g. AWS", onSave: (v) => save("certification", c.id, { issuer: v }) },
                      { label: "Date", value: c.date, placeholder: "e.g. 2024", onSave: (v) => save("certification", c.id, { date: v }) },
                    ]}
                  />
                  <div className="row">
                    <Field
                      className="f title"
                      value={c.name}
                      placeholder="Certification"
                      onSave={(v) => save("certification", c.id, { name: v })}
                      wrapClass="title"
                    />
                    <span className="dates">
                      <InlineField
                        value={c.date}
                        placeholder="date"
                        onSave={(v) => save("certification", c.id, { date: v })}
                      />
                    </span>
                  </div>
                  <Field
                    className="f org"
                    value={c.issuer}
                    placeholder="Issuer"
                    onSave={(v) => save("certification", c.id, { issuer: v })}
                    wrapClass="org"
                  />
                </div>
                </SortableItem>
              ))}
              </SortableContext>
              </DndContext>
            </section>
          )}
          {/* sections are added from the left control pane's "Add to résumé" */}
        </div>

        {/* left margin: compose an AI edit */}
        {ai && (
          <div className="ai-compose no-print" style={{ top: ai.top }}>
            <div className="ai-compose-label">✨ Edit with AI</div>
            <textarea
              className="ai-compose-input"
              value={ai.instruction}
              autoFocus
              rows={3}
              placeholder="Tell the AI how — e.g. tighten these, make them impact-focused, quantify"
              onChange={(e) => setAi((a) => (a ? { ...a, instruction: e.target.value } : a))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runAI();
                if (e.key === "Escape") setAi(null);
              }}
            />
            <div className="ai-compose-actions">
              <button className="ai-go" onClick={() => void runAI()} disabled={ai.loading || !ai.instruction.trim()}>
                {ai.loading ? "Refining…" : "Refine"}
              </button>
              <button className="ai-cancel" onClick={() => setAi(null)}>
                Cancel
              </button>
            </div>
            {ai.err && <div className="ai-err">{ai.err}</div>}
          </div>
        )}

        {/* right rail: the AI's proposed rewrite, outside the sheet */}
        {ai?.proposed && (
          <div className="ai-preview no-print" style={{ top: ai.top }}>
            <div className="ai-preview-label">Suggested rewrite — review, then accept</div>
            <ul>
              {ai.proposed.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <div className="ai-preview-actions">
              <button className="ai-accept" onClick={acceptAI}>
                Accept
              </button>
              <button className="ai-discard" onClick={() => setAi((a) => (a ? { ...a, proposed: null } : a))}>
                Discard
              </button>
            </div>
          </div>
        )}
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
            onClick={() => void downloadPdf()}
            disabled={pdfBusy}
          >
            {pdfBusy ? "Building…" : "Download PDF"}
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
            href="/mentor"
          >
            Looks good — talk to your mentor →
          </a>
        </div>
      </main>
        </div>
        <aside className="editor-rail editor-rail-right no-print">
            <div className="rail-group">
              <div className="rail-title">AI</div>
              <div className="ai-stack">
                <button className="redesign-btn" onClick={() => void redesign()} disabled={redesigning}>
                  {redesigning ? "Redesigning…" : "✨ Redesign with AI"}
                </button>
                <div className="redesign-hint">New look + sharper wording from your mentor&apos;s read of you. Review side-by-side.</div>
                {redesignErr && <div className="ai-err">{redesignErr}</div>}
  
                {/* target a job: JD in → tailored résumé + cover letter out */}
                <button className="rail-add" onClick={() => setJobOpen((v) => !v)}>
                  🎯 Target a job {jobOpen ? "▲" : "▼"}
                </button>
                {jobOpen && (
                  <div className="job-target">
                    <textarea
                      className="job-target-jd"
                      placeholder="Paste the job description here (optional for a general cover letter)…"
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                      rows={6}
                    />
                    <div className="job-target-actions">
                      <button className="tip-add" onClick={() => void generateLetter()} disabled={letterBusy}>
                        {letterBusy ? "Writing…" : "✉ Cover letter"}
                      </button>
                      <button
                        className="tip-add"
                        onClick={() => void redesign(jd)}
                        disabled={redesigning || !jd.trim()}
                        title={jd.trim() ? "Re-emphasize your résumé toward this job" : "Paste a JD first"}
                      >
                        {redesigning ? "Tailoring…" : "📄 Tailor résumé"}
                      </button>
                      <button
                        className="tip-add"
                        onClick={() => void checkAts()}
                        disabled={atsBusy || !jd.trim()}
                        title={jd.trim() ? "Which of this job's keywords does your résumé already pass?" : "Paste a JD first"}
                      >
                        {atsBusy ? "Checking…" : "🛡 ATS check"}
                      </button>
                    </div>
                    {letterErr && <div className="ai-err">{letterErr}</div>}
                    {ats && (
                      <div className="ats-result">
                        <div className="ats-score-row">
                          <AtsRing score={ats.score} />
                          <span className="ats-score-side">
                            <span className="ats-score-label">keyword match — what a screen sees, not what you&apos;re worth</span>
                            {atsPrev && (
                              <span className={`ats-delta ${ats.score > atsPrev.score ? "up" : ats.score < atsPrev.score ? "down" : ""}`}>
                                {ats.score === atsPrev.score
                                  ? `unchanged since last check`
                                  : `${atsPrev.score}% last check → ${ats.score > atsPrev.score ? "+" : ""}${ats.score - atsPrev.score}`}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="ats-chips">
                          {ats.required.map((k, i) => (
                            <span key={`r${i}`} className={`ats-chip ${k.hit ? "hit" : "miss"}`} title={k.hit ? "on your résumé" : "missing — add it if it's true"}>
                              {k.hit ? "✓" : "✗"} {k.term}
                              {!k.hit && (
                                <button
                                  className="ats-weave"
                                  onClick={() => void redesign(jd, [k.term])}
                                  disabled={redesigning}
                                  title={`Weave "${k.term}" in — rephrase bullets that truthfully show it to use this exact term. Never invents.`}
                                >
                                  ✎
                                </button>
                              )}
                            </span>
                          ))}
                          {ats.preferred.map((k, i) => (
                            <span key={`p${i}`} className={`ats-chip pref ${k.hit ? "hit" : "miss"}`} title="nice-to-have">
                              {k.hit ? "✓" : "○"} {k.term}
                              {!k.hit && (
                                <button
                                  className="ats-weave"
                                  onClick={() => void redesign(jd, [k.term])}
                                  disabled={redesigning}
                                  title={`Weave "${k.term}" in — rephrase bullets that truthfully show it to use this exact term. Never invents.`}
                                >
                                  ✎
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                        {ats.required.some((k) => !k.hit) && (
                          <div className="ats-note">
                            ✎ weaves one term into bullets that already prove it; <b>Tailor résumé</b> weaves all of them.
                            Missing something you actually have? Add it — never claim what isn&apos;t true.
                          </div>
                        )}
                        <div className="ats-recheck-hint">After applying a rewrite, run the check again to see the score move.</div>
                      </div>
                    )}
                  </div>
                )}
  
                {/* mentor tips — facts from the call that belong on the résumé */}
                {tips === null ? (
                  <button className="rail-add" onClick={() => void loadTips()} disabled={tipsState === "loading"}>
                    {tipsState === "loading" ? "Reading your call…" : "💡 Mentor tips from your call"}
                  </button>
                ) : tipsState === "none" ? (
                  <div className="tips-empty">No new résumé-worthy facts in your last call — talk to your mentor again as things happen.</div>
                ) : tipsState === "error" ? (
                  <div className="ai-err">Couldn&apos;t read your call — try again.</div>
                ) : (
                  <div className="tips-list">
                    {tips.map((t, i) => (
                      <div className={`tip${t.applied ? " applied" : ""}`} key={i}>
                        <div className="tip-meta">
                          {t.kind === "skill" ? "Skill" : t.entryLabel ?? "Bullet"}
                        </div>
                        <div className="tip-text">{t.text}</div>
                        <button className="tip-add" onClick={() => void applyTip(i)} disabled={!!t.applied || (t.kind === "bullet" && !t.entryId)}>
                          {t.applied ? "✓ Added" : t.kind === "bullet" && !t.entryId ? "No matching entry" : "+ Add"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
  
                {targetRole ? (
                  <div className="mentor-teaser">
                    <button className="mentor-teaser-head" onClick={() => setTargetOpen((v) => !v)}>
                      🎯 Aim for <strong>{targetRole.role}</strong>
                      <span className="mentor-teaser-caret">{targetOpen ? "▲" : "▼"}</span>
                    </button>
                    {targetOpen && (
                      <div className="mentor-teaser-body">
                        <p>{targetRole.rationale}</p>
                        <button className="mentor-teaser-cta" onClick={() => void redesign()} disabled={redesigning}>
                          Tighten résumé toward this →
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <a className="rail-add rail-ai-link" href="/mentor">🎙 Talk to mentor for tips →</a>
                )}
              </div>
            </div>
        </aside>
      </div>
    </>
  );
}

// ---------- design controls ----------

function Stepper({
  label,
  value,
  onChange,
  min = 0.8,
  max = 1.4,
  step = 0.05,
  fmt,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  fmt?: (v: number) => string; // default renders as a percentage
}) {
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
  return (
    <div className="design-row">
      <span>{label}</span>
      <span className="stepper">
        <button onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Decrease ${label}`}>−</button>
        <span className="stepper-val">{fmt ? fmt(value) : `${Math.round(value * 100)}%`}</span>
        <button onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`Increase ${label}`}>+</button>
      </span>
    </div>
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
  // auto-size each input to its content so "July 2025 – Present" reads tight
  // (no trailing gap from a fixed width), right-aligned as a clean meta line
  const w = (v: string, ph: string) => `${Math.max((v || ph).length + 1, 5)}ch`;
  return (
    <span className="dates">
      <input
        className="f dates-input"
        value={s}
        placeholder="start"
        onChange={(ev) => setS(ev.target.value)}
        onBlur={() => s !== (start ?? "") && onSave({ startDate: s })}
        style={{ width: w(s, "start"), textAlign: "right" }}
      />
      <span className="dates-dash">–</span>
      <input
        className="f dates-input"
        value={e}
        placeholder="end"
        onChange={(ev) => setE(ev.target.value)}
        onBlur={() => e !== (end ?? "") && onSave({ endDate: e })}
        style={{ width: w(e, "end") }}
      />
    </span>
  );
}

/** Per-entry ⚙ in the right margin: the home for meta fields that don't earn a
 *  permanent spot on the sheet (location, dates, subtitle). One gear per entry,
 *  a small popover, blur-to-save — fields render on the page once filled. */
function EntryGear({
  fields,
}: {
  fields: { label: string; value: string | null; placeholder: string; onSave: (v: string) => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<number, string>>({});
  return (
    <span className="entry-gear-wrap no-print">
      <button className="entry-gear" title="More details (dates, location…)" onClick={() => setOpen((v) => !v)}>
        ⚙
      </button>
      {open && (
        <span className="gear-pop">
          {fields.map((f, i) => (
            <label className="gear-field" key={f.label}>
              <span>{f.label}</span>
              <input
                className="f"
                defaultValue={f.value ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setDraft((d) => ({ ...d, [i]: e.target.value }))}
                onBlur={() => draft[i] !== undefined && draft[i] !== (f.value ?? "") && f.onSave(draft[i])}
              />
            </label>
          ))}
          <button className="tip-add" onClick={() => setOpen(false)}>Done</button>
        </span>
      )}
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
        if (next.map((b) => b.text).join("") !== bullets.map((b) => b.text).join("")) onSave(next);
      }}
    />
  );
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
