"use client";

/**
 * Jobs-loading animation — a drop of light forms, falls, and lands DEAD ON a
 * target (crosshair + converging reticle brackets + impact ripples + splash).
 * The metaphor is the whole product: we don't dump listings, we land the ones
 * that fit you, precisely. Ported from the "Drizzle Loading Drop" design; pure
 * canvas, one rAF loop, self-contained dark "scanner" stage that reads on either
 * theme. Used in place of the generic loader while recommendations score.
 */
import { useEffect, useRef } from "react";

const CLAY = "#C15F3C";
const CLAY_L = "#E39B72";
const CREAM = "#EFE4D2";
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (h: string, a: number) => {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${a})`;
};
const eOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const eInCubic = (x: number) => x * x * x;

export default function LoadingDrop({
  label = "Finding the roles you land just right",
  sub = "Scoring live openings against your profile",
}: {
  label?: string;
  sub?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

    const T = 2500, FORM = 540, IMPACT = 1200; // form → fall → land@IMPACT
    const splashAng = [-2.5, -2.0, -1.55, -1.1, -0.6, -Math.PI + 0.6, -Math.PI - 0.5];

    // teardrop path (tip up) authored ~0..64, CoM ~ (32,40)
    const dropPath = () => {
      ctx.beginPath();
      ctx.moveTo(32, 8);
      ctx.bezierCurveTo(32, 8, 10, 34, 10, 50);
      ctx.arc(32, 50, 22, Math.PI, 0, true);
      ctx.bezierCurveTo(54, 34, 32, 8, 32, 8);
      ctx.closePath();
    };
    const drawDrop = (x: number, y: number, sc: number, sx: number, sy: number, alpha: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sc * sx, sc * sy);
      ctx.translate(-32, -40);
      dropPath();
      const g = ctx.createLinearGradient(10, 8, 54, 72);
      g.addColorStop(0, CLAY_L);
      g.addColorStop(1, CLAY);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.shadowColor = rgba(CLAY, 0.5 * alpha);
      ctx.shadowBlur = 22;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(24, 46, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,244,232,0.55)";
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    const start = performance.now();
    let raf = 0, lastDraw = 0, tick = 0;

    const draw = (now: number) => {
      try {
        const t = (now - start) % T;
        const gt = (now - start) * 0.001;

        const cx = W * 0.5, cy = H * 0.56;
        const R = Math.min(W, H) * 0.26;
        const topY = H * 0.1;

        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";

        const sinceImpact = t - IMPACT;
        const impactK = sinceImpact > 0 ? Math.max(0, 1 - sinceImpact / 520) : 0;

        // ── target spot (rings) ──
        const breath = 1 + 0.015 * Math.sin(gt * 1.4);
        const flash = impactK * 0.5;
        [1.0, 0.64, 0.32].forEach((f, i) => {
          ctx.beginPath();
          ctx.arc(cx, cy, R * f * breath, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(i === 0 ? CLAY : CLAY_L, 0.24 + flash + (i === 2 ? 0.12 : 0));
          ctx.lineWidth = i === 0 ? 2 : 1.5;
          ctx.stroke();
        });
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2 + gt * 0.05;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * R * 1.06, cy + Math.sin(a) * R * 1.06);
          ctx.lineTo(cx + Math.cos(a) * R * 1.11, cy + Math.sin(a) * R * 1.11);
          ctx.strokeStyle = rgba(CLAY_L, 0.12 + flash * 0.4);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // center crosshair (the exact spot)
        const chA = 0.35 + 0.3 * Math.sin(gt * 2) - impactK * 0.4;
        if (chA > 0) {
          ctx.strokeStyle = rgba(CREAM, chA);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(cx - 8, cy);
          ctx.lineTo(cx + 8, cy);
          ctx.moveTo(cx, cy - 8);
          ctx.lineTo(cx, cy + 8);
          ctx.stroke();
        }

        // ── reticle brackets converge as the drop falls, lock on impact ──
        let bracketR: number, bAlpha: number;
        if (t < IMPACT) {
          const s = eOutCubic(Math.min(1, t / IMPACT));
          bracketR = R * (1.55 - 0.47 * s);
          bAlpha = 0.22 + 0.5 * s;
        } else {
          bracketR = R * 1.08;
          bAlpha = 0.72 - impactK * 0.25;
        }
        const bl = R * 0.22;
        ctx.strokeStyle = rgba(CREAM, bAlpha);
        ctx.lineWidth = 2;
        ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([sx, sy]) => {
          const x = cx + sx * bracketR, y = cy + sy * bracketR;
          ctx.beginPath();
          ctx.moveTo(x, y + sy * -bl);
          ctx.lineTo(x, y);
          ctx.lineTo(x + sx * -bl, y);
          ctx.stroke();
        });

        // ── impact ripples ──
        if (sinceImpact > 0) {
          for (let n = 0; n < 2; n++) {
            const age = sinceImpact - n * 150;
            if (age <= 0) continue;
            const prog = age / 760;
            if (prog >= 1) continue;
            ctx.beginPath();
            ctx.arc(cx, cy, R * 0.28 + prog * R * 1.25, 0, Math.PI * 2);
            ctx.strokeStyle = rgba(CLAY_L, (1 - prog) * 0.5);
            ctx.lineWidth = 2 * (1 - prog) + 0.5;
            ctx.stroke();
          }
        }

        ctx.globalCompositeOperation = "source-over";

        // ── the falling drop ──
        if (t < FORM) {
          // forms at top, growing, gentle hover
          const s = eOutCubic(t / FORM);
          const yb = topY + Math.sin(gt * 3) * 3;
          drawDrop(cx, yb, (R / 130) * s, 1, 1, s);
        } else if (t < IMPACT) {
          const p = eInCubic((t - FORM) / (IMPACT - FORM));
          const y = topY + (cy - topY) * p;
          const sy = 1 + 0.55 * p, sx = 1 - 0.16 * p;
          // motion streak
          const grad = ctx.createLinearGradient(0, y - R * 1.4, 0, y);
          grad.addColorStop(0, rgba(CLAY_L, 0));
          grad.addColorStop(1, rgba(CLAY_L, 0.35 * p));
          ctx.strokeStyle = grad;
          ctx.lineWidth = 2.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(cx, y - R * (0.5 + p));
          ctx.lineTo(cx, y);
          ctx.stroke();
          drawDrop(cx, y, R / 130, sx, sy, 1);
        } else {
          // landed: squash-bounce residual, absorbing; splash droplets
          const bk = Math.max(0, 1 - sinceImpact / 300);
          const sx = 1 + 0.7 * bk, sy = 1 - 0.45 * bk;
          const dAlpha = Math.max(0, 1 - sinceImpact / 420);
          if (dAlpha > 0) drawDrop(cx, cy, R / 130, sx, sy, dAlpha);
          // splash mini droplets (arc out + gravity)
          for (let i = 0; i < splashAng.length; i++) {
            const a = splashAng[i];
            const age = sinceImpact;
            if (age > 640) continue;
            const spd = 0.34 + (i % 3) * 0.05;
            const px = cx + Math.cos(a) * spd * age;
            const py = cy + Math.sin(a) * spd * age + 0.0011 * age * age;
            const sz = Math.max(0, 3.2 - age / 220);
            if (sz <= 0 || py > cy + R) continue;
            ctx.beginPath();
            ctx.arc(px, py, sz, 0, Math.PI * 2);
            ctx.fillStyle = rgba(CLAY_L, Math.max(0, 1 - age / 640));
            ctx.fill();
          }
        }

        lastDraw = now;
      } catch {
        /* keep the loop alive across a transient draw error */
      }
    };

    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    draw(performance.now());
    // rAF can throttle when the tab/section is hidden; a slow interval keeps it honest
    tick = window.setInterval(() => {
      const n = performance.now();
      if (n - lastDraw > 140) draw(n);
    }, 90);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(tick);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="loading-drop" role="status" aria-label={label}>
      <div className="loading-drop-stage">
        <canvas ref={canvasRef} />
      </div>
      <div className="loading-drop-cap">
        <div className="loading-drop-label">
          {label}
          <span className="loading-drop-dots">…</span>
        </div>
        <div className="loading-drop-sub">{sub}</div>
      </div>
    </div>
  );
}
