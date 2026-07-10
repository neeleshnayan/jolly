"use client";

/**
 * The voice-mentor presence — one drop of light that listens, thinks, and speaks.
 * Ported from the "Drizzle Voice Mentor" design (canvas orb, three states, each
 * with its own palette + motion). The design ran on a SIMULATED speech envelope;
 * here the envelope is the REAL audio amplitude the call already measures (mic
 * while you talk, the mentor's TTS while it speaks) — passed in via `levelRef`,
 * a 0–1 value updated every frame with no React re-render. `mode` comes from the
 * call phase. Silence → the drop settles; speech → it swells and radiates.
 */
import { useEffect, useRef, type RefObject } from "react";

export type OrbMode = "listening" | "thinking" | "speaking" | "ready";

// per-mode palette + behaviour (verbatim from the design's P table)
const P: Record<"listening" | "thinking" | "speaking", { c1: string; c2: string; accent: string; amp: number; wob: number; glow: number; breath: number; bs: number }> = {
  listening: { c1: "#F2C6A6", c2: "#C77A52", accent: "#9FB0C4", amp: 0.1, wob: 0.02, glow: 0.42, breath: 0.03, bs: 0.55 },
  thinking: { c1: "#F4D69A", c2: "#C9922F", accent: "#E7B34E", amp: 0.05, wob: 0.028, glow: 0.36, breath: 0.016, bs: 0.7 },
  speaking: { c1: "#F8D0AC", c2: "#CC7049", accent: "#E39B72", amp: 0.19, wob: 0.038, glow: 0.54, breath: 0.022, bs: 0.7 },
};

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (h: string, a: number) => {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${a})`;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpArr = (A: number[], B: number[], t: number) => A.map((v, i) => lerp(v, B[i], t));
const toHex = (arr: number[]) => `#${arr.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export default function VoiceOrb({ mode, levelRef, size = 300 }: { mode: OrbMode; levelRef?: RefObject<number>; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<Exclude<OrbMode, "ready">>("listening");
  // "ready" (pre-speech idle) reads as a calm listening drop
  modeRef.current = mode === "ready" ? "listening" : mode;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const ripples: { r: number; a: number; sp: number }[] = [];
    const particles = Array.from({ length: 14 }, (_, i) => ({
      ang: (i / 14) * Math.PI * 2,
      rad: 0.7 + ((i * 37) % 100) / 100 * 0.9, // deterministic spread (no Math.random at import)
      spd: 0.15 + ((i * 53) % 100) / 100 * 0.25,
      size: 1.2 + ((i * 29) % 100) / 100 * 2.2,
      ph: ((i * 71) % 100) / 100 * Math.PI * 2,
    }));

    let env = 0.1;
    const cur: { c1: number[]; c2: number[]; accent: number[]; amp: number; wob: number; glow: number; breath: number; bs: number } = {
      c1: hex(P.listening.c1), c2: hex(P.listening.c2), accent: hex(P.listening.accent), amp: 0.1, wob: 0.02, glow: 0.42, breath: 0.03, bs: 0.55,
    };

    let raf = 0;
    const start = performance.now();
    let lastRipple = 0;

    const frame = (now: number) => {
      try {
        const t = (now - start) * 0.001;
        const modeNow = modeRef.current;
        const p = P[modeNow];

        // smooth palette/behaviour transitions between states
        cur.c1 = lerpArr(cur.c1, hex(p.c1), 0.06);
        cur.c2 = lerpArr(cur.c2, hex(p.c2), 0.06);
        cur.accent = lerpArr(cur.accent, hex(p.accent), 0.06);
        cur.amp = lerp(cur.amp, p.amp, 0.06);
        cur.wob = lerp(cur.wob, p.wob, 0.06);
        cur.glow = lerp(cur.glow, p.glow, 0.06);
        cur.breath = lerp(cur.breath, p.breath, 0.06);
        cur.bs = lerp(cur.bs, p.bs, 0.06);
        const C1 = toHex(cur.c1), C2 = toHex(cur.c2), AC = toHex(cur.accent);

        // envelope: the REAL audio amplitude (0–1). While thinking, no stream is
        // playing, so let it settle to a soft idle so the drop still breathes.
        const liveLevel = levelRef?.current ?? 0;
        const target = modeNow === "thinking" ? 0.12 : liveLevel;
        env = lerp(env, target, target > env ? 0.35 : 0.12);

        const cx = W / 2, cy = H * 0.5;
        const R0 = Math.min(W, H) * 0.15;
        const R = R0 * (1 + cur.breath * Math.sin(t * cur.bs * Math.PI) + env * cur.amp * 3.2);

        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";

        // ── ripples ──
        const rInterval = modeNow === "speaking" ? 340 : modeNow === "listening" ? 1300 : 1e9;
        const emitPeak = modeNow === "speaking" && env > 0.7;
        if (now - lastRipple > rInterval || emitPeak) {
          if (now - lastRipple > (emitPeak ? 300 : rInterval)) {
            lastRipple = now;
            ripples.push({ r: R * 1.05, a: modeNow === "speaking" ? 0.34 : 0.32, sp: modeNow === "speaking" ? 0.7 + env * 0.9 : 0.5 });
          }
        }
        for (let i = ripples.length - 1; i >= 0; i--) {
          const rp = ripples[i];
          rp.r += rp.sp;
          rp.a *= 0.975;
          if (rp.a < 0.01) {
            ripples.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(AC, rp.a);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        // ── outer glow ──
        const gR = R * 3.4;
        const g = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, gR);
        g.addColorStop(0, rgba(C2, 0.42 * cur.glow + env * 0.18));
        g.addColorStop(0.5, rgba(C2, 0.1 * cur.glow));
        g.addColorStop(1, rgba(C2, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, gR, 0, Math.PI * 2);
        ctx.fill();

        // ── thinking: orbiting particles ──
        if (modeNow === "thinking" || cur.amp < 0.09) {
          const fade = modeNow === "thinking" ? 1 : Math.max(0, 1 - (cur.amp - 0.05) / 0.04);
          for (const pt of particles) {
            pt.ang += pt.spd * 0.012;
            const orbit = R * (1.55 + 0.5 * Math.sin(t * 0.6 + pt.ph)) * (0.6 + pt.rad * 0.4);
            const px = cx + Math.cos(pt.ang) * orbit;
            const py = cy + Math.sin(pt.ang) * orbit * 0.92;
            const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2 + pt.ph));
            ctx.beginPath();
            ctx.arc(px, py, pt.size, 0, Math.PI * 2);
            ctx.fillStyle = rgba(AC, 0.7 * tw * fade);
            ctx.fill();
          }
        }

        // ── the drop (organic blob) ──
        ctx.globalCompositeOperation = "source-over";
        const wob = cur.wob;
        ctx.beginPath();
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const rr = R * (1 + wob * Math.sin(a * 3 + t * 1.3) + wob * 0.6 * Math.sin(a * 5 - t * 1.7) + wob * 0.4 * Math.sin(a * 2 + t * 0.9));
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const bg = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.4, R * 0.1, cx, cy, R * 1.15);
        bg.addColorStop(0, rgba("#FFF6EC", 0.95));
        bg.addColorStop(0.28, C1);
        bg.addColorStop(1, C2);
        ctx.fillStyle = bg;
        ctx.shadowColor = rgba(C2, 0.5);
        ctx.shadowBlur = R * 0.6;
        ctx.fill();
        ctx.shadowBlur = 0;

        // rim light
        ctx.strokeStyle = rgba("#FFE9D6", 0.22);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // specular highlight
        const sp = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.42, 0, cx - R * 0.34, cy - R * 0.42, R * 0.6);
        sp.addColorStop(0, "rgba(255,255,255,0.7)");
        sp.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = sp;
        ctx.beginPath();
        ctx.ellipse(cx - R * 0.3, cy - R * 0.36, R * 0.42, R * 0.3, -0.5, 0, Math.PI * 2);
        ctx.fill();

        // ── thinking: sweeping comet arc ──
        if (modeNow === "thinking") {
          const ring = R * 1.9;
          const base = t * 1.4;
          for (let i = 0; i < 46; i++) {
            const a = base - i * 0.03;
            const px = cx + Math.cos(a) * ring;
            const py = cy + Math.sin(a) * ring * 0.94;
            ctx.beginPath();
            ctx.arc(px, py, 2.1, 0, Math.PI * 2);
            ctx.fillStyle = rgba(AC, (1 - i / 46) * 0.5);
            ctx.fill();
          }
        }
      } catch {
        /* keep the loop alive across a transient draw error */
      }
    };

    const loop = (now: number) => {
      frame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    frame(performance.now()); // immediate first paint

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [levelRef]);

  return (
    <div className="voice-orb" style={{ width: size, height: size }} role="img" aria-label={`Mentor is ${mode === "ready" ? "listening" : mode}`}>
      <canvas ref={canvasRef} />
    </div>
  );
}
