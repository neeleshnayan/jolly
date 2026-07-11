"use client";

/**
 * "Every career you admire began as an unlikely pivot" — famous people whose
 * careers were themselves wild transitions, in the same from → to shape drizzle's
 * mentor cards use. Per the v2 design this lives just below the final CTA and
 * reveals ONE figure at a time, each popping in with a soft fade/scale. All in
 * good spirit (and all true pivots). Portraits hotlink Wikimedia Commons; if one
 * can't load (offline demo) it falls back to warm initials. Reduced-motion → the
 * cycle still advances but without the transform.
 */
import { useEffect, useState } from "react";

const HEADING = "#F1EADC";
const ACCENT = "#D07A54";

type Great = { name: string; initials: string; img: string; from: string; to: string; note: string; grad: string };

const wiki = (file: string, width = 220) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;

const GREATS: Great[] = [
  { name: "Albert Einstein", initials: "AE", img: wiki("Albert Einstein Head.jpg"), from: "Patent clerk", to: "Physics, rewritten", note: "Kept the day job while drafting relativity", grad: "linear-gradient(140deg,#C89B6A,#A9673A)" },
  { name: "Marie Curie", initials: "MC", img: wiki("Marie Curie c1920.jpg"), from: "Governess", to: "Two Nobel Prizes", note: "Self-taught between tutoring jobs", grad: "linear-gradient(140deg,#8FA36E,#5F7A44)" },
  { name: "Jane Goodall", initials: "JG", img: wiki("Jane Goodall 2015.jpg"), from: "Secretary", to: "Primatologist", note: "Sailed to Gombe with no degree", grad: "linear-gradient(140deg,#D98E6A,#C15F3C)" },
  { name: "Mark Zuckerberg", initials: "MZ", img: wiki("Mark Zuckerberg F8 2019 Keynote (32830578717) (cropped).jpg"), from: "Psych undergrad", to: "CEO, Meta", note: "Shipped v1 from a dorm room", grad: "linear-gradient(140deg,#C89B6A,#A9673A)" },
  { name: "Sam Altman", initials: "SA", img: wiki("Sam Altman CropEdit James Tamim.jpg"), from: "Stanford dropout", to: "CEO, OpenAI", note: "Founder → investor → AGI — pick a lane? No.", grad: "linear-gradient(140deg,#D98E6A,#C15F3C)" },
  { name: "Steve Jobs", initials: "SJ", img: wiki("Steve Jobs Headshot 2010-CROP.jpg"), from: "Reed dropout", to: "Apple, reinvented", note: "A calligraphy class he sat in on became the Mac's fonts", grad: "linear-gradient(140deg,#C89B6A,#A9673A)" },
  { name: "Dario Amodei", initials: "DA", img: wiki("Dario Amodei.jpg"), from: "Physicist", to: "CEO, Anthropic", note: "Biophysics PhD → AI safety", grad: "linear-gradient(140deg,#D98E6A,#C15F3C)" },
  { name: "Amitabh Bachchan", initials: "AB", img: wiki("Amitabh Bachchan December 2013.jpg"), from: "Shipping-firm clerk", to: "Cinema legend", note: "Once rejected by All India Radio for his voice", grad: "linear-gradient(140deg,#8FA36E,#5F7A44)" },
  { name: "Vera Wang", initials: "VW", img: wiki("Vera Wang 2018.jpg"), from: "Figure skater", to: "Fashion icon", note: "Designed her first dress at 40", grad: "linear-gradient(140deg,#C89B6A,#A9673A)" },
  { name: "Arnold Schwarzenegger", initials: "AS", img: wiki("Arnold Schwarzenegger by Gage Skidmore 4.jpg"), from: "Bodybuilder", to: "Governor of California", note: "Mr. Universe → Hollywood → the Capitol", grad: "linear-gradient(140deg,#D98E6A,#C15F3C)" },
];

function Face({ g }: { g: Great }) {
  const [broken, setBroken] = useState(false);
  return broken ? (
    <div style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0, background: g.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#F3ECDE", fontWeight: 700, fontSize: 15, boxShadow: "0 0 0 1px rgba(255,240,210,0.14)" }}>{g.initials}</div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={g.img} alt={g.name} width={48} height={48} loading="lazy" onError={() => setBroken(true)} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0, boxShadow: "0 0 0 1px rgba(255,240,210,0.14)", filter: "saturate(0.9)" }} />
  );
}

export default function FamousPivots() {
  const [i, setI] = useState(0);
  const [vis, setVis] = useState(true);
  // hold the current figure, then fade it out
  useEffect(() => {
    const hold = setTimeout(() => setVis(false), 2900);
    return () => clearTimeout(hold);
  }, [i]);
  // once faded, swap to the next figure and fade it back in
  useEffect(() => {
    if (vis) return;
    const swap = setTimeout(() => { setI((n) => (n + 1) % GREATS.length); setVis(true); }, 460);
    return () => clearTimeout(swap);
  }, [vis]);

  const g = GREATS[i];
  return (
    <div style={{ marginTop: "clamp(56px,8vw,90px)", width: "100%", maxWidth: 1120 }}>
      {/* preload every portrait up front so each pop shows the photo instantly,
          not a flash of initials while it lazy-loads */}
      <div aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        {GREATS.map((x) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={x.name} src={x.img} alt="" width={1} height={1} />
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A8172", marginBottom: 28 }}>Every career you admire began as an unlikely pivot</div>
      <div style={{ display: "flex", justifyContent: "center", minHeight: 176 }}>
        <div className="lp-pivot" style={{ width: 360, maxWidth: "100%", opacity: vis ? 1 : 0, transform: vis ? "translateY(0) scale(1)" : "translateY(10px) scale(0.97)", transition: "opacity 0.45s ease, transform 0.45s ease" }}>
          <div style={{ background: "#211D18", border: "1px solid rgba(230,210,170,0.12)", borderRadius: 16, padding: 20, textAlign: "left", boxShadow: "0 26px 60px -40px rgba(0,0,0,0.9)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <Face g={g} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: HEADING, lineHeight: 1.2 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: "#8A8172", marginTop: 3, lineHeight: 1.35 }}>{g.note}</div>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 9, flexWrap: "wrap", background: "rgba(230,210,170,0.04)", border: "1px solid rgba(230,210,170,0.07)", borderRadius: 10, padding: "9px 13px" }}>
              <span style={{ fontSize: 12.5, color: "#948B7C" }}>{g.from}</span>
              <span style={{ color: ACCENT, fontWeight: 700 }}>→</span>
              <span style={{ fontSize: 13, color: "#F4EEE1", fontWeight: 600 }}>{g.to}</span>
            </div>
          </div>
        </div>
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "#6F6759", margin: "20px auto 0", maxWidth: 460, fontStyle: "italic" }}>*Not in the drizzle circle. Yet. The people who are made moves just as real — theirs just aren&apos;t on Wikipedia.</p>
    </div>
  );
}
