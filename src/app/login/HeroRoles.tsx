"use client";

/**
 * Hero product shot — one job card that CYCLES through diverse roles so an
 * engineer in SF, a nurse in London, a PM in Bengaluru, a designer working
 * remote, and a lawyer in Singapore all see themselves in the first ten
 * seconds. Same card chrome as the app; content swaps with a soft fade.
 */
import { useEffect, useState } from "react";

const ACCENT = "#D07A54";
const HEADING = "#F1EADC";
const chip = { display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, lineHeight: 1 } as const;
const dot = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: 4, fontSize: 10, fontWeight: 800 } as const;
const metaCell = { flex: 1, minWidth: 130, padding: "14px 18px" } as const;
const metaL = { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#8A8172", marginBottom: 5 };
const metaV = { fontSize: 15, fontWeight: 600, color: "#E7DECD" };
const green = { bg: "rgba(166,192,131,0.13)", fg: "#B6CE95", bd: "1px solid rgba(166,192,131,0.22)", dot: "rgba(166,192,131,0.22)" };
const amber = { bg: "rgba(219,164,65,0.13)", fg: "#E0B45C", bd: "1px solid rgba(219,164,65,0.24)", dot: "rgba(219,164,65,0.22)" };

type Role = {
  fit: number;
  title: string;
  company: string;
  source: string;
  chips: { ok: boolean; text: string }[];
  comp: string;
  location: string;
  style: string;
  exp: string;
  blurb: string;
};

// five professions, five geographies — the whole point is "this is for you too"
const ROLES: Role[] = [
  {
    fit: 85,
    title: "Data Platform Engineer",
    company: "Figma",
    source: "GREENHOUSE",
    chips: [
      { ok: true, text: "Résumé shows 3 of 3 required skills" },
      { ok: true, text: "Building lines up" },
      { ok: false, text: "You want more risk than this offers" },
    ],
    comp: "$235k–$376k",
    location: "San Francisco · US",
    style: "Hybrid",
    exp: "5+ yrs",
    blurb: "Own the core ML and data platform behind Figma's AI features — pipelines for prompt processing, product-facing data systems, and tooling that helps Data Science ship models.",
  },
  {
    fit: 82,
    title: "Senior Product Manager",
    company: "Razorpay",
    source: "LEVER",
    chips: [
      { ok: true, text: "Your payments background lines up" },
      { ok: true, text: "Zero-to-one ownership — what you asked for" },
      { ok: false, text: "Asks for SQL — not on your résumé" },
    ],
    comp: "₹48L–₹65L",
    location: "Bengaluru · India",
    style: "Hybrid",
    exp: "6+ yrs",
    blurb: "Own the merchant-onboarding journey end to end — the funnel where every new business meets Razorpay. You'd run discovery, ship weekly, and answer to a number the whole company watches.",
  },
  {
    fit: 88,
    title: "Clinical Nurse Educator",
    company: "Bupa",
    source: "WORKDAY",
    chips: [
      { ok: true, text: "Registration & acute-care experience check out" },
      { ok: true, text: "Mentoring is the job — your strongest signal" },
      { ok: false, text: "Less hands-on care than you're used to" },
    ],
    comp: "£52k–£61k",
    location: "London · UK",
    style: "On-site",
    exp: "4+ yrs",
    blurb: "Design and deliver the clinical training programme across two hospitals — precepting new nurses, running simulation days, and keeping ward practice aligned with current evidence.",
  },
  {
    fit: 79,
    title: "Brand Designer",
    company: "Duolingo",
    source: "GREENHOUSE",
    chips: [
      { ok: true, text: "Portfolio shows systems thinking, not one-offs" },
      { ok: true, text: "Playful voice lines up" },
      { ok: false, text: "You wanted a smaller team than this" },
    ],
    comp: "$128k–$164k",
    location: "Remote · US",
    style: "Remote",
    exp: "3+ yrs",
    blurb: "Evolve the visual world of the owl — campaign craft, motion moments, and brand systems that keep Duolingo unmistakable across every surface from app store to billboard.",
  },
  {
    fit: 84,
    title: "Corporate Counsel, Product",
    company: "Stripe",
    source: "GREENHOUSE",
    chips: [
      { ok: true, text: "Fintech regulatory work checks out" },
      { ok: true, text: "Cross-border scope — the stretch you wanted" },
      { ok: false, text: "Wants bar admission in SG — verify yours" },
    ],
    comp: "S$180k–S$240k",
    location: "Singapore",
    style: "Hybrid",
    exp: "7+ yrs",
    blurb: "Be the legal partner for payment products across APAC — advising launch teams on licensing, drafting the terms real businesses sign, and telling product 'yes, like this' more than 'no'.",
  },
];

const CIRC = 276.5; // 2πr for r=44

export default function HeroRoles() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % ROLES.length), 5200);
    return () => clearInterval(t);
  }, []);
  const r = ROLES[i];

  return (
    <div style={{ position: "relative", background: "#211D18", border: "1px solid rgba(230,210,170,0.12)", borderRadius: 26, padding: "clamp(24px,3vw,38px)", boxShadow: "0 50px 100px -40px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,240,210,0.04)", maxWidth: 900, margin: "0 auto" }}>
      {/* key change retriggers the fade-in — a soft swap, not a hard cut */}
      <div key={i} className="lp-role-swap">
        <div className="lp-role-head" style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 18 }}>
          <div style={{ position: "relative", width: 104, height: 104, flexShrink: 0 }}>
            <svg width="104" height="104" viewBox="0 0 104 104" style={{ transform: "rotate(-90deg)" }} aria-hidden>
              <circle cx="52" cy="52" r="44" fill="none" stroke="rgba(230,210,170,0.10)" strokeWidth="6" />
              <circle cx="52" cy="52" r="44" fill="none" stroke={ACCENT} strokeWidth="6" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - r.fit / 100)} style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
              <span style={{ fontFamily: '"Newsreader", Georgia, serif', fontWeight: 600, fontSize: 34, color: HEADING }}>{r.fit}</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#8A8172", marginTop: 3 }}>% FIT</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: '"Newsreader", Georgia, serif', fontWeight: 500, fontSize: "clamp(24px,3vw,32px)", color: HEADING, letterSpacing: "-0.015em", lineHeight: 1.1 }}>{r.title}</div>
            {/* board tag lives quietly beside the company — metadata, not a headline */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15.5, color: "#948B7C" }}>{r.company}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: "#7C7365", border: "1px solid rgba(230,210,170,0.14)", borderRadius: 6, padding: "3px 7px", whiteSpace: "nowrap" }}>{r.source}</span>
            </div>
          </div>
        </div>
        {/* chips sit full-width under the header — on mobile a 2-col grid where
            green pills pair up and the amber warning takes its own full row */}
        <div className="lp-role-chips" style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 18 }}>
          {r.chips.map((c) => {
            const p = c.ok ? green : amber;
            return (
              <span key={c.text} className={`lp-chip ${c.ok ? "ok" : "warn"}`} style={{ ...chip, background: p.bg, color: p.fg, border: p.bd }}>
                <span style={{ ...dot, background: p.dot, color: p.fg }}>{c.ok ? "✓" : "!"}</span> {c.text}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", border: "1px solid rgba(230,210,170,0.10)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ ...metaCell, borderRight: "1px solid rgba(230,210,170,0.10)" }}><div style={metaL}>COMP</div><div style={metaV}>{r.comp}</div></div>
          <div style={{ ...metaCell, borderRight: "1px solid rgba(230,210,170,0.10)" }}><div style={metaL}>LOCATION</div><div style={metaV}>{r.location}</div></div>
          <div style={{ ...metaCell, borderRight: "1px solid rgba(230,210,170,0.10)" }}><div style={metaL}>WORK STYLE</div><div style={metaV}>{r.style}</div></div>
          <div style={metaCell}><div style={metaL}>EXPERIENCE</div><div style={metaV}>{r.exp}</div></div>
        </div>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#A79E8D", margin: "22px 0 0", minHeight: 75 }}>{r.blurb}</p>
      </div>

      {/* which profession is on stage — and a nudge that there are more */}
      <div style={{ display: "flex", justifyContent: "center", gap: 7, marginTop: 20 }}>
        {ROLES.map((_, d) => (
          <button
            key={d}
            onClick={() => setI(d)}
            aria-label={`Show ${ROLES[d].title}`}
            style={{ width: d === i ? 22 : 7, height: 7, borderRadius: 999, border: "none", cursor: "pointer", padding: 0, background: d === i ? ACCENT : "rgba(230,210,170,0.18)", transition: "all 0.35s ease" }}
          />
        ))}
      </div>
    </div>
  );
}
