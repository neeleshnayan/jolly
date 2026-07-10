"use client";

/**
 * "Patron saints of the career pivot" — a playful strip in the Community
 * section: famous people whose careers were themselves wild transitions, in
 * exactly the from → to format drizzle's mentor cards use. All in good spirit
 * (and all true pivots). Portraits hotlink Wikimedia Commons (public/CC
 * images); if one can't load (offline demo), it falls back to warm initials.
 */
import { useState } from "react";

const HEADING = "#F1EADC";
const ACCENT = "#D07A54";

type Great = { name: string; initials: string; img: string; from: string; to: string; note: string; grad: string };

const wiki = (file: string, width = 220) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;

const GREATS: Great[] = [
  {
    name: "Albert Einstein",
    initials: "AE",
    img: wiki("Albert Einstein Head.jpg"),
    from: "Patent clerk",
    to: "Physics, rewritten",
    note: "Kept the day job while drafting relativity",
    grad: "linear-gradient(140deg,#C89B6A,#A9673A)",
  },
  {
    name: "Marie Curie",
    initials: "MC",
    img: wiki("Marie Curie c1920.jpg"),
    from: "Governess",
    to: "Two Nobel Prizes",
    note: "Self-taught between tutoring jobs",
    grad: "linear-gradient(140deg,#8FA36E,#5F7A44)",
  },
  {
    name: "Jane Goodall",
    initials: "JG",
    img: wiki("Jane Goodall 2015.jpg"),
    from: "Secretary",
    to: "Primatologist",
    note: "Sailed to Gombe with no degree",
    grad: "linear-gradient(140deg,#D98E6A,#C15F3C)",
  },
  {
    name: "Mark Zuckerberg",
    initials: "MZ",
    img: wiki("Mark Zuckerberg F8 2019 Keynote (32830578717) (cropped).jpg"),
    from: "Psych undergrad",
    to: "CEO, Meta",
    note: "Shipped v1 from a dorm room",
    grad: "linear-gradient(140deg,#C89B6A,#A9673A)",
  },
  {
    name: "Sam Altman",
    initials: "SA",
    img: wiki("Sam Altman CropEdit James Tamim.jpg"),
    from: "Stanford dropout",
    to: "CEO, OpenAI",
    note: "Founder → investor → AGI — pick a lane? No.",
    grad: "linear-gradient(140deg,#D98E6A,#C15F3C)",
  },
];

function Face({ g }: { g: Great }) {
  const [broken, setBroken] = useState(false);
  return broken ? (
    <div style={{ width: 62, height: 62, borderRadius: "50%", flexShrink: 0, background: g.grad, display: "flex", alignItems: "center", justifyContent: "center", color: "#F3ECDE", fontWeight: 700, fontSize: 19, border: "2px solid rgba(255,240,210,0.14)" }}>{g.initials}</div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={g.img}
      alt={g.name}
      width={62}
      height={62}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: 62, height: 62, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid rgba(255,240,210,0.14)", filter: "saturate(0.9)" }}
    />
  );
}

export default function FamousPivots() {
  return (
    <div style={{ marginTop: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: ACCENT }}>In good spirit</span>
        <span style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 22, color: HEADING, letterSpacing: "-0.01em" }}>The patron saints of the career pivot</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
        {GREATS.map((g) => (
          <div key={g.name} className="lp-pillar" style={{ background: "#211D18", border: "1px solid rgba(230,210,170,0.10)", borderRadius: 18, padding: "20px 20px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 14 }}>
              <Face g={g} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: HEADING, lineHeight: 1.2 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: "#948B7C", marginTop: 3 }}>{g.note}</div>
              </div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "rgba(230,210,170,0.04)", border: "1px solid rgba(230,210,170,0.08)", borderRadius: 10, padding: "9px 12px" }}>
              <span style={{ fontSize: 12.5, color: "#948B7C" }}>{g.from}</span>
              <span style={{ color: ACCENT, fontWeight: 700 }}>→</span>
              <span style={{ fontSize: 12.5, color: "#E7DECD", fontWeight: 600 }}>{g.to}</span>
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: "#6F6759", margin: "16px 0 0", fontStyle: "italic" }}>
        *Not actually in the drizzle circle. Yet. The people who are in it made moves just as real — theirs just aren&apos;t on Wikipedia.
      </p>
    </div>
  );
}
