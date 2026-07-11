"use client";
import { useMemo } from "react";

/**
 * Live résumé metrics — 100% client-side analysis of the user's OWN résumé.
 * Zero server, instant on every keystroke: counts, quantification + strong-verb
 * coverage, and weak-opener / passive-voice flags. The logic is generic writing
 * hygiene (not our IP), the data is theirs and already in the browser — a
 * textbook "juice the idle silicon" offload.
 */
type Bullet = { text: string };
type Entry = { bullets?: Bullet[] | null };
export type MetricsInput = {
  experiences: Entry[];
  projects: Entry[];
  skills: { name?: string | null }[];
  summary?: string | null;
};

const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const WEAK = /^(responsible for|worked on|helped|assisted with|assisted in|involved in|participated in|duties included|tasked with|in charge of|contributed to)\b/i;
const PASSIVE = /\b(was|were|been|being|are|is)\s+\w+(ed|en)\b/i;
const STRONG =
  /^(led|built|shipped|designed|launched|grew|drove|cut|reduced|increased|architected|created|delivered|owned|scaled|founded|spearheaded|improved|streamlined|automated|developed|engineered|initiated|established|generated|negotiated|mentored|analy[sz]ed|optimi[sz]ed|implemented|orchestrated|pioneered|transformed|accelerated|boosted|slashed|won|closed|launched|rebuilt|migrated|shipped)\b/i;
const QUANT = /(\d+(\.\d+)?\s*%|[$£€₹][\d,]+|\b\d[\d,]*(\.\d+)?\s*(k|m|bn|x|users?|customers?|clients?|hours?|days?|weeks?|months?|years?|people|teams?|projects?|deals?|leads?|countries|markets?|%)?)/i;

export function computeMetrics(input: MetricsInput) {
  const bullets = [...(input.experiences ?? []), ...(input.projects ?? [])]
    .flatMap((e) => (e.bullets ?? []).map((b) => strip(b.text)))
    .filter(Boolean);
  const words =
    bullets.join(" ").split(/\s+/).filter(Boolean).length +
    strip(input.summary ?? "").split(/\s+/).filter(Boolean).length;
  const weak = bullets.filter((b) => WEAK.test(b));
  const passive = bullets.filter((b) => !WEAK.test(b) && PASSIVE.test(b));
  const quantified = bullets.filter((b) => QUANT.test(b)).length;
  const strongOpen = bullets.filter((b) => STRONG.test(b)).length;
  const n = bullets.length || 1;
  return {
    words,
    bulletCount: bullets.length,
    quantifiedPct: Math.round((quantified / n) * 100),
    strongOpenPct: Math.round((strongOpen / n) * 100),
    skills: (input.skills ?? []).length,
    weak: weak.slice(0, 5),
    passive: passive.slice(0, 5),
  };
}

function Bar({ label, pct, hint }: { label: string; pct: number; hint: string }) {
  const tone = pct >= 60 ? "#22c55e" : pct >= 35 ? "#f59e0b" : "#ef4444";
  return (
    <div className="rm-bar" title={hint}>
      <div className="rm-bar-top">
        <span>{label}</span>
        <span style={{ color: tone, fontWeight: 650 }}>{pct}%</span>
      </div>
      <div className="rm-track">
        <div className="rm-fill" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

export default function ResumeMetrics({ data, pages }: { data: MetricsInput; pages?: number }) {
  const m = useMemo(() => computeMetrics(data), [data]);
  if (!m.bulletCount) return null;
  const flags = [...m.weak.map((t) => ({ t, why: "weak opener" })), ...m.passive.map((t) => ({ t, why: "passive" }))].slice(0, 5);
  return (
    <div className="resume-metrics">
      <div className="rm-head">
        <span>Résumé strength</span>
        <span className="rm-sub">
          {m.words} words · {m.bulletCount} bullets{pages ? ` · ~${pages}p` : ""}
        </span>
      </div>
      <Bar label="Quantified" pct={m.quantifiedPct} hint="Bullets with a number, %, or $ — proof beats adjectives." />
      <Bar label="Strong openers" pct={m.strongOpenPct} hint="Bullets that start with an action verb (Led, Built, Shipped…)." />
      {flags.length > 0 && (
        <div className="rm-flags">
          <div className="rm-flags-title">Tighten these ({flags.length})</div>
          {flags.map((f, i) => (
            <div className="rm-flag" key={i}>
              <span className="rm-flag-tag">{f.why}</span>
              <span className="rm-flag-text">{f.t.length > 70 ? f.t.slice(0, 70) + "…" : f.t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
