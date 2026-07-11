"use client";
import { useEffect, useState } from "react";
import VoiceOrb, { type OrbMode } from "../mentor/VoiceOrb";

/**
 * Landing-only wrapper: reuses the real call-time VoiceOrb and gently cycles it
 * through its states so the mentor feels alive on the marketing page. No canvas
 * code here — the orb is the exact component the live call renders.
 */
const CYCLE: { mode: OrbMode; ms: number }[] = [
  { mode: "listening", ms: 3800 },
  { mode: "thinking", ms: 2600 },
  { mode: "speaking", ms: 4400 },
];

export default function OrbShowcase() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % CYCLE.length), CYCLE[i].ms);
    return () => clearTimeout(t);
  }, [i]);
  return <VoiceOrb mode={CYCLE[i].mode} size={236} />;
}
