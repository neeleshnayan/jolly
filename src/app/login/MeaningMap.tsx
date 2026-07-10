"use client";
import { useEffect, useRef } from "react";

/**
 * The "meaning map" — the trajectory-matching visual from the design kit
 * (Drizzle Meaning Map). One fixed "You" point; the beam sweeps to each of three
 * futures in turn, warming the roles that lie along your DIRECTION — including a
 * hero role that shares zero keywords with your past — while keyword-only matches
 * pulse once then cool. Direction > keywords, shown not told. Pure canvas 2D, so
 * this is a near-verbatim port of the design's render loop into a React effect.
 * Respects prefers-reduced-motion (paints the resolved hero frame).
 */
const CYCLE_MS = 9000;

export default function MeaningMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let CW = 0, CH = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      CW = cv.clientWidth; CH = cv.clientHeight;
      cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    type C = [number, number, number];
    const TERRA: C = [193, 95, 60], TERRA_L: C = [227, 155, 114], CREAM: C = [201, 191, 173];
    const BODY: C = [178, 169, 152], DIM: C = [150, 141, 124], COOL: C = [104, 97, 84];
    const rgba = (c: C, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const mix = (a: C, b: C, t: number): C => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
    const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

    const you = { x: 0.13, y: 0.83 };
    type Node = { x: number; y: number; label: string; bright?: number; rise?: number; hero?: boolean };
    const trajectories: { dest: Node; mids: Node[] }[] = [
      { dest: { x: 0.575, y: 0.17, label: "Founding Engineer", bright: 0.9, rise: 11 },
        mids: [{ x: 0.34, y: 0.55, label: "Product Engineer", bright: 0.66, rise: 8 }, { x: 0.47, y: 0.36, label: "Staff Engineer", bright: 0.74, rise: 9 }] },
      { dest: { x: 0.90, y: 0.30, label: "AI Field Engineer", bright: 0.9, rise: 10 },
        mids: [{ x: 0.52, y: 0.55, label: "Data Engineer", bright: 0.64, rise: 8 }, { x: 0.74, y: 0.44, label: "AI Solutions Lead", bright: 0.74, rise: 9 }] },
      { dest: { x: 0.80, y: 0.20, label: "Forward-Deployed Engineer", bright: 1.0, rise: 13, hero: true },
        mids: [{ x: 0.36, y: 0.62, label: "Solutions Engineer", bright: 0.7, rise: 8 }, { x: 0.53, y: 0.48, label: "ML Engineer", bright: 0.82, rise: 9 }, { x: 0.66, y: 0.37, label: "Platform Engineer", bright: 0.76, rise: 8 }] },
    ];
    const keyword: Node[] = [
      { x: 0.29, y: 0.90, label: "Data Analyst" }, { x: 0.07, y: 0.66, label: "Revenue Analyst" }, { x: 0.36, y: 0.77, label: "Sales Ops" },
    ];
    const neutral: Node[] = [
      { x: 0.63, y: 0.75, label: "Growth PM" }, { x: 0.77, y: 0.64, label: "BizOps" }, { x: 0.92, y: 0.57, label: "Customer Success" }, { x: 0.84, y: 0.86, label: "Support Lead" },
    ];
    const constLinks = [[0, 1], [1, 2], [3, 0]];

    const px = (n: { x: number; y: number }) => ({ x: n.x * CW, y: n.y * CH });
    const drawNode = (p: { x: number; y: number }, r: number, colGlow: C, glowA: number, glowR: number, core: C, coreA: number) => {
      if (glowA > 0.002) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        g.addColorStop(0, rgba(colGlow, glowA)); g.addColorStop(1, rgba(colGlow, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = rgba(core, coreA); ctx.fill();
    };
    const label = (p: { x: number; y: number }, text: string, dy: number, col: C, a: number, weight: number, size: number) => {
      if (a <= 0.02) return;
      ctx.font = `${weight} ${size}px 'Hanken Grotesk', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const half = ctx.measureText(text).width / 2 + 5;
      const cxc = Math.max(half, Math.min(CW - half, p.x));
      ctx.fillStyle = rgba(col, a); ctx.fillText(text, cxc, p.y + dy);
    };

    const WIN = [
      { sw: [0.10, 0.24], fd: [0.30, 0.38] },
      { sw: [0.42, 0.56], fd: [0.62, 0.70] },
      { sw: [0.72, 0.86], fd: [0.955, 1.0] },
    ];
    const segState = (i: number, nt: number) => {
      const w = WIN[i];
      return { sweep: smooth(w.sw[0], w.sw[1], nt), fade: smooth(w.fd[0], w.fd[1], nt) };
    };

    const render = (t: number) => {
      const nt = (t / CYCLE_MS) % 1;
      const pulseEnv = nt < 0.11 ? Math.sin(clamp(nt / 0.11) * Math.PI) : 0;
      const coolF = smooth(0.10, 0.17, nt);
      const youP = px(you);
      ctx.clearRect(0, 0, CW, CH);

      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      constLinks.forEach(([a, b]) => {
        const pa = px(neutral[a]), pb = px(neutral[b]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.strokeStyle = rgba(DIM, 0.10); ctx.stroke();
      });

      ctx.save(); ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
      trajectories.forEach((tr) => {
        const hp0 = px(tr.dest);
        ctx.beginPath(); ctx.moveTo(youP.x, youP.y); ctx.lineTo(hp0.x, hp0.y); ctx.strokeStyle = rgba(DIM, 0.09); ctx.stroke();
      });
      ctx.restore();

      trajectories.forEach((tr, i) => {
        const { sweep, fade } = segState(i, nt);
        const beamA = sweep * (1 - fade);
        if (beamA <= 0.01) return;
        const hp = px(tr.dest);
        const dx = hp.x - youP.x, dy = hp.y - youP.y;
        const dlen = Math.hypot(dx, dy), ux = dx / dlen, uy = dy / dlen;
        const perp = { x: -uy, y: ux };
        const beamLen = dlen * 1.14 * sweep;
        ctx.globalCompositeOperation = "lighter";
        const tip = { x: youP.x + ux * beamLen, y: youP.y + uy * beamLen };
        const apexHalf = 7, tipHalf = 40 * (0.45 + 0.55 * sweep);
        const g = ctx.createLinearGradient(youP.x, youP.y, tip.x, tip.y);
        g.addColorStop(0, rgba(TERRA_L, 0.05 * beamA)); g.addColorStop(0.35, rgba(TERRA_L, 0.17 * beamA)); g.addColorStop(1, rgba(TERRA_L, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(youP.x + perp.x * apexHalf, youP.y + perp.y * apexHalf);
        ctx.lineTo(tip.x + perp.x * tipHalf, tip.y + perp.y * tipHalf);
        ctx.lineTo(tip.x - perp.x * tipHalf, tip.y - perp.y * tipHalf);
        ctx.lineTo(youP.x - perp.x * apexHalf, youP.y - perp.y * apexHalf);
        ctx.closePath(); ctx.fill();
        const gc = ctx.createLinearGradient(youP.x, youP.y, tip.x, tip.y);
        gc.addColorStop(0, rgba(TERRA_L, 0.30 * beamA)); gc.addColorStop(1, rgba(TERRA_L, 0));
        ctx.strokeStyle = gc; ctx.lineWidth = 2; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(youP.x, youP.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
        if (beamA > 0.2) {
          const lp = { x: youP.x + ux * dlen * 0.44 - perp.x * 19, y: youP.y + uy * dlen * 0.44 - perp.y * 19 };
          ctx.save(); ctx.translate(lp.x, lp.y); ctx.rotate(Math.atan2(uy, ux));
          ctx.font = "600 10px 'Hanken Grotesk', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = rgba(BODY, 0.5 * beamA);
          ctx.fillText("O N E   P A T H   Y O U   C O U L D   T A K E", 0, 0);
          ctx.restore();
        }
      });

      neutral.forEach((n) => {
        const p = px(n); drawNode(p, 4.5, DIM, 0.14, 15, DIM, 0.62); label(p, n.label, 15, BODY, 0.46, 500, 10.5);
      });

      keyword.forEach((n) => {
        const p = px(n);
        const coolK = coolF;
        const glowA = 0.42 * pulseEnv * (1 - coolK) + 0.10 * (1 - coolK);
        const glowR = 16 + 12 * pulseEnv;
        const coreCol = mix(mix(BODY, TERRA_L, 0.45 * pulseEnv), COOL, coolK);
        drawNode(p, 4.5, TERRA_L, glowA, glowR, coreCol, 0.82 * (1 - 0.45 * coolK));
        label(p, n.label, 15, mix(BODY, COOL, coolK), 0.6 - 0.26 * coolK, 500, 10.5);
      });

      trajectories.forEach((tr, i) => {
        const { sweep, fade } = segState(i, nt);
        const hp = px(tr.dest);
        const dx = hp.x - youP.x, dy = hp.y - youP.y;
        const dlen = Math.hypot(dx, dy), ux = dx / dlen, uy = dy / dlen;
        const all = tr.mids.concat([tr.dest]);
        all.forEach((n) => {
          const p = px(n);
          const proj = (p.x - youP.x) * ux + (p.y - youP.y) * uy;
          const reachT = clamp(proj / dlen);
          const reached = smooth(reachT * 0.7, reachT * 0.7 + 0.3, sweep);
          const warm = reached * (n.bright ?? 0.7) * (1 - fade);
          if (warm <= 0.02) {
            drawNode(p, 4.5, DIM, 0.12, 14, DIM, 0.52); label(p, n.label, -14, BODY, 0.34, 500, n.hero ? 11 : 10.5); return;
          }
          p.y -= (n.rise ?? 8) * warm;
          ctx.strokeStyle = rgba(TERRA_L, 0.22 * warm); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(youP.x, youP.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          const r = 4.5 + (n.hero ? 2 : 1) * warm;
          const glowR = 15 + warm * (n.hero ? 34 : 22);
          drawNode(p, r, TERRA_L, 0.5 * warm + 0.04, glowR, mix(BODY, TERRA_L, warm), 0.62 + 0.38 * warm);
          if (n.hero && warm > 0.3) drawNode(p, 2, [255, 244, 232], 0.6 * warm, 10, [255, 244, 232], 0.9 * warm);
          label(p, n.label, -14, mix(BODY, CREAM, warm), 0.5 + 0.5 * warm, n.hero ? 700 : 600, n.hero ? 12 : 10.5);
        });
      });

      const yr = 8;
      drawNode(youP, yr, TERRA_L, 0.55, 30, TERRA_L, 1);
      const gy = ctx.createRadialGradient(youP.x - 3, youP.y - 3, 0, youP.x, youP.y, yr);
      gy.addColorStop(0, "rgba(255,240,225,0.9)"); gy.addColorStop(1, rgba(TERRA, 1));
      ctx.fillStyle = gy; ctx.beginPath(); ctx.arc(youP.x, youP.y, yr, 0, Math.PI * 2); ctx.fill();
      label(youP, "You", 20, CREAM, 0.95, 700, 11.5);
    };

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { render(0.86 * CYCLE_MS); return () => window.removeEventListener("resize", resize); }

    const t0 = performance.now();
    let raf = 0, lastDraw = 0;
    const tick = (now: number) => { try { render(now - t0); lastDraw = now; } catch { /* canvas gone */ } };
    const loop = (now: number) => { tick(now); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    tick(performance.now());
    const int = window.setInterval(() => { const n = performance.now(); if (n - lastDraw > 140) tick(n); }, 90);

    return () => { cancelAnimationFrame(raf); clearInterval(int); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <div style={{ height: "clamp(420px,58vw,520px)", background: "#211D18", border: "1px solid rgba(230,210,170,0.08)", borderRadius: 22, boxShadow: "0 40px 90px -50px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,240,210,0.04)", padding: "18px 24px 14px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ position: "relative", flex: 1, minHeight: 0, margin: "0 -6px" }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      </div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid rgba(230,210,170,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "linear-gradient(140deg,#E39B72,#C15F3C)", boxShadow: "0 0 8px rgba(216,142,106,0.6)" }} />
          <span style={{ fontSize: 12, color: "#B9B0A0" }}>Aligned to your trajectory</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#7C7365" }} />
          <span style={{ fontSize: 12, color: "#8A8172" }}>Keyword-only match</span>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: "#8FA36E" }}>Direction &gt; keywords</span>
      </div>
    </div>
  );
}
