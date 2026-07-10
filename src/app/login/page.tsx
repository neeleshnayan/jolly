import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import HeroRoles from "./HeroRoles";
import FamousPivots from "./FamousPivots";
import MeaningMap from "./MeaningMap";

/**
 * The front door — the "Drizzle Landing" marketing page from the design kit.
 * Dark, warm, editorial (Newsreader serif + Hanken Grotesk). Every CTA is the
 * LinkedIn sign-in. Static server component; hover/animation live in globals.css.
 */
export const metadata = { title: "drizzle — the job search, finally on your side" };

const ACCENT = "#D07A54";
const HEADING = "#F1EADC";

function Mark({ size = 30, color = ACCENT }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" fill={color} d="M26 21a18 18 0 1 0 0 36 18 18 0 1 0 0-36ZM24 31c-4 4-6.5 7-6.5 10.5a6.5 6.5 0 0 0 13 0c0-3.5-2.5-6.5-6.5-10.5Z" />
      <rect x="40" y="6" width="8" height="49" rx="4" fill={color} />
    </svg>
  );
}

function LinkedInCTA({ size = "lg" }: { size?: "lg" | "md" }) {
  const pad = size === "lg" ? "17px 30px" : "16px 26px";
  const fs = size === "lg" ? 17 : 16.5;
  return (
    <a
      className="lp-li"
      href="/api/auth/linkedin"
      style={{ display: "inline-flex", alignItems: "center", gap: 11, background: "#0A66C2", color: "#fff", fontWeight: 700, fontSize: fs, padding: pad, borderRadius: 14, boxShadow: "0 18px 40px -14px rgba(10,102,194,0.8)" }}
    >
      <span style={{ width: 25, height: 25, borderRadius: 6, background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" /></svg>
      </span>
      Continue with LinkedIn
    </a>
  );
}

const kicker = { fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: ACCENT, marginBottom: 16 };
const h2Serif = { fontFamily: '"Newsreader", Georgia, serif', fontWeight: 500, color: HEADING, lineHeight: 1.1, letterSpacing: "-0.02em", margin: 0 } as const;
const pillar = { background: "#211D18", border: "1px solid rgba(230,210,170,0.10)", borderRadius: 20, padding: "32px 30px 34px" } as const;
const pillarIcon = { width: 52, height: 52, borderRadius: 14, background: "rgba(208,122,84,0.12)", border: "1px solid rgba(208,122,84,0.22)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22, color: "#D98E6A" } as const;
const pillarTitle = { fontFamily: '"Newsreader", Georgia, serif', fontWeight: 500, fontSize: 23, color: HEADING, letterSpacing: "-0.01em", marginBottom: 10 } as const;
const pillarBody = { fontSize: 15, lineHeight: 1.6, color: "#9E9484" } as const;

const SOURCES = ["Greenhouse", "Lever", "Ashby", "Workday", "LinkedIn"];
const SKILLS = [
  { name: "ML infrastructure", w: "72%", n: "5 roles" },
  { name: "feature pipelines", w: "58%", n: "4 roles" },
  { name: "model serving", w: "46%", n: "3 roles" },
  { name: "workflow orchestration", w: "38%", n: "2 roles" },
];
const HAVE = ["python ×20", "sql ×11", "react ×6", "dbt ×4", "aws ×3", "airflow ×3"];
const PEERS = [
  { initials: "PS", name: "Priya S.", now: "Data Platform Eng · Stripe", from: "Data Analyst", to: "Data Platform Eng", shared: "4 skills in common", grad: "linear-gradient(140deg,#D98E6A,#C15F3C)" },
  { initials: "MO", name: "Marcus O.", now: "ML Engineer · Ramp", from: "Backend SWE", to: "ML Engineer", shared: "made the leap last year", grad: "linear-gradient(140deg,#C89B6A,#A9673A)" },
  { initials: "LK", name: "Lena K.", now: "Founding Engineer · seed startup", from: "Product Manager", to: "Founding Engineer", shared: "open to referrals", grad: "linear-gradient(140deg,#8FA36E,#5F7A44)" },
];
const sageSm = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: "rgba(166,192,131,0.10)", color: "#A6C083", border: "1px solid rgba(166,192,131,0.18)" } as const;
const stackAv = { width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#F3ECDE", border: "2px solid #1A1712" } as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUserId()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Quicksand:wght@500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <main className="lp">
        {/* ambient rain field */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1100, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
          <div className="lp-glow" style={{ position: "absolute", width: 760, height: 760, left: "50%", marginLeft: -380, top: -260, borderRadius: "50%", background: "radial-gradient(circle, rgba(208,122,84,0.16), transparent 66%)", filter: "blur(20px)", animation: "drz-glow 9s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: 520, height: 520, right: -140, top: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(120,95,60,0.14), transparent 70%)", filter: "blur(20px)" }} />
        </div>

        <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "0 clamp(20px,5vw,40px)" }}>
          {/* NAV */}
          <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 0 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Mark size={30} />
              <span style={{ fontFamily: '"Quicksand", sans-serif', fontWeight: 600, fontSize: 22, color: "#ECE4D5", letterSpacing: "-0.02em" }}>drizzle</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
              {/* hidden ≤640px (see globals.css) — logo + Get started carry mobile */}
              <div className="lp-nav-links" style={{ display: "flex", alignItems: "center", gap: 30, fontSize: 14.5 }}>
                <a className="lp-link" href="#how">How it works</a>
                <a className="lp-link" href="#fit">Honest matching</a>
                <a className="lp-link" href="#community">Community</a>
                <a className="lp-link" href="#cost">At cost</a>
              </div>
              <a className="lp-cta" href="/api/auth/linkedin" style={{ background: ACCENT, color: "#14120E", fontWeight: 700, fontSize: 14.5, padding: "10px 20px", borderRadius: 11, boxShadow: "0 10px 26px -12px rgba(208,122,84,0.7)" }}>Get started</a>
            </div>
          </nav>

          {/* HERO */}
          <header style={{ padding: "clamp(60px,11vw,120px) 0 60px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9, border: "1px solid rgba(230,210,170,0.14)", background: "rgba(230,210,170,0.04)", borderRadius: 999, padding: "7px 15px 7px 11px", marginBottom: 30 }}>
              <span className="lp-bob" style={{ display: "inline-flex", animation: "drz-bob 2.6s cubic-bezier(0.5,0,0.5,1) infinite", transformOrigin: "center bottom" }}>
                <svg width="13" height="13" viewBox="0 0 64 64" fill="none" aria-hidden><path fillRule="evenodd" clipRule="evenodd" fill={ACCENT} d="M32 8C24 20 18 30 18 40a14 14 0 0 0 28 0c0-10-6-20-14-32Z" /></svg>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.02em", color: "#C9BFAD", fontStyle: "italic", fontFamily: '"Newsreader", Georgia, serif' }}>the first rain after the drought</span>
            </div>

            <h1 className="lp-serif" style={{ fontWeight: 500, color: HEADING, fontSize: "clamp(42px,7.4vw,82px)", lineHeight: 1.02, letterSpacing: "-0.025em", margin: "0 0 24px", maxWidth: "15ch", textWrap: "balance" }}>
              The job search, finally <span style={{ fontStyle: "italic", color: "#D98E6A" }}>on your side.</span>
            </h1>

            <p style={{ fontSize: "clamp(17px,2.3vw,21px)", lineHeight: 1.55, color: "#A79E8D", margin: "0 0 40px", maxWidth: 620 }}>
              drizzle is an AI career copilot that learns who you&apos;re becoming, matches you <em style={{ color: "#C9BFAD", fontStyle: "italic" }}>honestly</em>, and applies in one motion — so action beats inaction.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center", marginBottom: 20 }}>
              <LinkedInCTA size="md" />
              <a className="lp-ghost" href="#how" style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(230,210,170,0.18)", color: "#D6CCBA", fontWeight: 600, fontSize: 16.5, padding: "16px 24px", borderRadius: 14 }}>See how it works →</a>
            </div>
            <div style={{ fontSize: 13, color: "#7C7365" }}>No résumé upload needed · <span style={{ color: "#A6C083" }}>Runs at cost</span></div>
            {error && <p style={{ marginTop: 18, color: "#E0B45C", fontSize: 13 }}>Sign-in didn&apos;t complete ({error}). Please try again.</p>}
          </header>

          {/* HERO PRODUCT SHOT — the job slider: cycles diverse roles/geographies
              so everyone sees themselves in the first ten seconds (HeroRoles.tsx) */}
          <div style={{ perspective: 1600, marginBottom: 20 }}>
            <div className="lp-float" style={{ animation: "drz-float 8s ease-in-out infinite", willChange: "transform" }}>
              <HeroRoles />
            </div>
          </div>

          {/* trust sources */}
          <div style={{ textAlign: "center", padding: "56px 0 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6F6759", marginBottom: 20 }}>Pulls live roles from</div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "14px 40px" }}>
              {SOURCES.map((s) => (
                <span key={s} style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 21, color: "#8A8172", letterSpacing: "-0.01em" }}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* HOW IT WORKS */}
        <section id="how" style={{ position: "relative", zIndex: 1, background: "#1A1712", borderTop: "1px solid rgba(230,210,170,0.07)", borderBottom: "1px solid rgba(230,210,170,0.07)", padding: "clamp(72px,10vw,120px) clamp(20px,5vw,40px)", marginTop: 60 }}>
          <div style={{ maxWidth: 1160, margin: "0 auto" }}>
            <div style={{ maxWidth: 640, marginBottom: 56 }}>
              <div style={kicker}>One copilot, end to end</div>
              <h2 style={{ ...h2Serif, fontSize: "clamp(30px,4.6vw,50px)", lineHeight: 1.08 }}>Not another job board.<br />A mentor that <span style={{ fontStyle: "italic", color: "#D98E6A" }}>remembers.</span></h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20 }}>
              <div className="lp-pillar" style={pillar}>
                <div style={pillarIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" stroke="#D98E6A" strokeWidth="1.8" /><path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" stroke="#D98E6A" strokeWidth="1.8" strokeLinecap="round" /></svg></div>
                <div style={pillarTitle}>A mentor who remembers</div>
                <div style={pillarBody}>Short voice calls build a real read on who you&apos;re becoming — and every session picks up where you left off.</div>
              </div>
              <div className="lp-pillar" style={pillar}>
                <div style={pillarIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="8" stroke="#D98E6A" strokeWidth="1.8" /><circle cx="12" cy="12" r="3.4" stroke="#D98E6A" strokeWidth="1.8" /><circle cx="12" cy="12" r="0.6" fill="#D98E6A" /></svg></div>
                <div style={pillarTitle}>Honestly matched roles</div>
                <div style={pillarBody}>Ranked by what you&apos;d genuinely want and what the screen truly requires — the one watch-out surfaced, never buried.</div>
              </div>
              <div className="lp-pillar" style={pillar}>
                <div style={pillarIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M7 4h7l4 4v12H7z" stroke="#D98E6A" strokeWidth="1.8" strokeLinejoin="round" /><path d="M14 4v4h4" stroke="#D98E6A" strokeWidth="1.8" strokeLinejoin="round" /><path d="M9.5 12.5h5M9.5 15.5h5" stroke="#D98E6A" strokeWidth="1.6" strokeLinecap="round" /></svg></div>
                <div style={pillarTitle}>Apply in one motion</div>
                <div style={pillarBody}>Tailored résumé, cover letter, and every fiddly application answer — staged the moment you click apply.</div>
              </div>
            </div>
          </div>
        </section>

        {/* HONEST MATCHING · trajectory map + the two-read diagnostic */}
        <section id="fit" style={{ position: "relative", zIndex: 1, padding: "clamp(72px,10vw,120px) clamp(20px,5vw,40px)" }}>
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <div style={{ maxWidth: 680, margin: "0 auto 44px", textAlign: "center" }}>
              <div style={kicker}>Honest matching</div>
              <h2 style={{ ...h2Serif, fontSize: "clamp(30px,4.4vw,48px)", lineHeight: 1.1, margin: "0 0 20px" }}>Ranked to where you&apos;re going — not what you&apos;re called.</h2>
              <p style={{ fontSize: 16.5, lineHeight: 1.6, color: "#A79E8D", margin: 0 }}>We match on <em style={{ color: "#C9BFAD" }}>trajectory</em>, not keywords. From one starting point we surface the paths open to you — even roles that share zero words with your past — then help you refine the one that fits.</p>
            </div>

            <div style={{ maxWidth: 760, margin: "0 auto" }}>
              <MeaningMap />
            </div>

            <div style={{ marginTop: "clamp(64px,9vw,104px)" }}>
              <div style={{ maxWidth: 680, margin: "0 auto 40px", textAlign: "center" }}>
                <div style={kicker}>The diagnostic</div>
                <h3 style={{ ...h2Serif, fontSize: "clamp(26px,3.6vw,38px)", lineHeight: 1.12, margin: "0 0 16px" }}>Two honest reads on where you stand.</h3>
                <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#A79E8D", margin: 0 }}>Before it ranks a single role, drizzle takes stock — what you&apos;ve already proven, and what your target path still asks for. Together they narrate the distance between today and where you&apos;re headed.</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, alignItems: "stretch" }}>
                {/* A: strengths */}
                <div style={{ background: "#211D18", border: "1px solid rgba(230,210,170,0.10)", borderRadius: 20, padding: 30 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(166,192,131,0.16)", color: "#A6C083", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>A</span>
                    <span style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 20, color: HEADING }}>What you&apos;re already strong at</span>
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.55, color: "#948B7C", margin: "0 0 22px" }}>Proven on your résumé — the foundation every match is built from.</p>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A6C083", marginBottom: 14 }}>Already on your résumé</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {HAVE.map((h) => (
                      <span key={h} style={sageSm}><span style={{ color: "#A6C083" }}>✓</span> {h}</span>
                    ))}
                  </div>
                </div>

                {/* B: gaps */}
                <div style={{ background: "#211D18", border: "1px solid rgba(230,210,170,0.10)", borderRadius: 20, padding: 30 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(216,142,106,0.18)", color: "#E0A579", fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>B</span>
                    <span style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 20, color: HEADING }}>What still stands in the way</span>
                  </div>
                  <p style={{ fontSize: 14, lineHeight: 1.55, color: "#948B7C", margin: "0 0 22px" }}>The skills your target roles keep asking for — your clearest next moves.</p>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT, marginBottom: 16 }}>The market keeps asking</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {SKILLS.map((s) => (
                      <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 120, flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: "#C9BFAD" }}>{s.name}</div>
                        <div style={{ flex: 1, height: 8, borderRadius: 6, background: "rgba(230,210,170,0.08)", overflow: "hidden" }}><div style={{ height: "100%", width: s.w, borderRadius: 6, background: "linear-gradient(90deg,#D98E6A,#C15F3C)" }} /></div>
                        <div style={{ width: 48, textAlign: "right", fontSize: 12, color: "#8A8172" }}>{s.n}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p style={{ textAlign: "center", fontSize: 14.5, color: "#8A8172", margin: "28px auto 0", maxWidth: 560 }}>Strengths you build from, gaps you close — that&apos;s the route to where you want to go.</p>
            </div>
          </div>
        </section>

        {/* COMMUNITY — mentor connect */}
        <section id="community" style={{ position: "relative", zIndex: 1, background: "#1A1712", borderTop: "1px solid rgba(230,210,170,0.07)", padding: "clamp(72px,10vw,120px) clamp(20px,5vw,40px)" }}>
          <div style={{ maxWidth: 1160, margin: "0 auto" }}>
            <div style={{ maxWidth: 660, marginBottom: 52 }}>
              <div style={kicker}>You&apos;re not alone in this</div>
              <h2 style={{ ...h2Serif, fontSize: "clamp(30px,4.6vw,50px)", lineHeight: 1.08, margin: "0 0 20px" }}>Walk the path with people <span style={{ fontStyle: "italic", color: "#D98E6A" }}>already on it.</span></h2>
              <p style={{ fontSize: 16.5, lineHeight: 1.6, color: "#A79E8D", margin: 0, maxWidth: 600 }}>drizzle introduces you to people one or two steps ahead on the same trajectory — for honest advice, warm referrals, and the reminder that the leap you&apos;re making has been made before.</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, marginBottom: 32 }}>
              {PEERS.map((p) => (
                <div key={p.name} className="lp-pillar" style={{ ...pillar, padding: "26px 26px 22px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                    <div style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0, background: p.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#F3ECDE", fontWeight: 700, fontSize: 15, border: "1px solid rgba(255,240,210,0.12)" }}>{p.initials}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: HEADING }}>{p.name}</div>
                      <div style={{ fontSize: 13, color: "#948B7C" }}>{p.now}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", background: "rgba(230,210,170,0.04)", border: "1px solid rgba(230,210,170,0.08)", borderRadius: 11, padding: "11px 13px", marginBottom: 18 }}>
                    <span style={{ fontSize: 13, color: "#948B7C" }}>{p.from}</span>
                    <span style={{ color: ACCENT, fontWeight: 700 }}>→</span>
                    <span style={{ fontSize: 13, color: "#E7DECD", fontWeight: 600 }}>{p.to}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={sageSm}><span style={{ color: "#A6C083" }}>✓</span> {p.shared}</span>
                    <a className="lp-ghost" href="/api/auth/linkedin" style={{ border: "1px solid rgba(230,210,170,0.18)", color: "#D6CCBA", fontWeight: 600, fontSize: 13, padding: "8px 16px", borderRadius: 10 }}>Connect</a>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ display: "flex" }}>
                <div style={{ ...stackAv, background: "linear-gradient(140deg,#D98E6A,#C15F3C)" }}>RN</div>
                <div style={{ ...stackAv, background: "linear-gradient(140deg,#C89B6A,#A9673A)", marginLeft: -10 }}>TF</div>
                <div style={{ ...stackAv, background: "linear-gradient(140deg,#8FA36E,#5F7A44)", marginLeft: -10 }}>JK</div>
                <div style={{ ...stackAv, background: "rgba(230,210,170,0.10)", color: "#C9BFAD", marginLeft: -10 }}>+</div>
              </div>
              <span style={{ fontSize: 14.5, color: "#948B7C" }}><span style={{ color: "#C9BFAD", fontWeight: 600 }}>200+ people</span> one step ahead on your exact path.</span>
            </div>

            {/* inspirational figures — famous people who made dramatic trajectory
                shifts. reinforces "the leap you're making has been made before" */}
            <FamousPivots />
          </div>
        </section>

        {/* AT COST */}
        <section id="cost" style={{ position: "relative", zIndex: 1, background: "#1A1712", borderTop: "1px solid rgba(230,210,170,0.07)", padding: "clamp(80px,11vw,130px) clamp(20px,5vw,40px)" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9, border: "1px solid rgba(166,192,131,0.28)", background: "rgba(166,192,131,0.08)", borderRadius: 999, padding: "7px 16px", marginBottom: 28, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.04em", color: "#A6C083" }}>RUNS AT COST</div>
            <h2 style={{ ...h2Serif, fontSize: "clamp(30px,5vw,52px)", lineHeight: 1.12, margin: "0 0 24px", textWrap: "balance" }}>Built after watching good people face a lost job <span style={{ fontStyle: "italic", color: "#D98E6A" }}>alone.</span></h2>
            <p style={{ fontSize: "clamp(17px,2.2vw,20px)", lineHeight: 1.6, color: "#A79E8D", margin: "0 auto", maxWidth: 600 }}>So drizzle doesn&apos;t profit off the search. You pay only what it takes to keep the lights on — nothing more. When you&apos;re between jobs, that matters.</p>
          </div>
        </section>

        {/* FINAL CTA */}
        <section id="start" style={{ position: "relative", zIndex: 1, padding: "clamp(80px,12vw,140px) clamp(20px,5vw,40px)", textAlign: "center", overflow: "hidden" }}>
          <div style={{ position: "absolute", width: 620, height: 620, left: "50%", top: "50%", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(208,122,84,0.16), transparent 66%)", filter: "blur(30px)", pointerEvents: "none" }} />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="lp-bob" style={{ animation: "drz-bob 2.6s cubic-bezier(0.5,0,0.5,1) infinite", transformOrigin: "center bottom", marginBottom: 26 }}><Mark size={52} /></div>
            <h2 style={{ ...h2Serif, fontSize: "clamp(34px,5.6vw,62px)", lineHeight: 1.05, letterSpacing: "-0.025em", margin: "0 0 22px", maxWidth: "16ch", textWrap: "balance" }}>Clarity today. A better career tomorrow.</h2>
            <p style={{ fontSize: 18, color: "#A79E8D", margin: "0 0 36px", maxWidth: 460 }}>One sign-in with LinkedIn and your copilot starts learning who you&apos;re becoming.</p>
            <LinkedInCTA />
            <div style={{ fontSize: 13, color: "#7C7365", marginTop: 18 }}>We only read your name, email, and photo to set up your account.</div>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ position: "relative", zIndex: 1, borderTop: "1px solid rgba(230,210,170,0.07)", padding: "34px clamp(20px,5vw,40px)" }}>
          <div style={{ maxWidth: 1160, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Mark size={22} color="#8A8172" />
              <span style={{ fontFamily: '"Quicksand", sans-serif', fontWeight: 600, fontSize: 16, color: "#8A8172" }}>drizzle</span>
            </div>
            <div style={{ fontSize: 13, color: "#6F6759" }}>© 2026 drizzle · the first rain after the drought</div>
          </div>
        </footer>
      </main>
    </>
  );
}
