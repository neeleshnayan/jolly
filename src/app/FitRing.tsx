/**
 * Role-fit gauge — a terracotta ring that arcs to the fit %. Purposeful and
 * legible; themed off --accent. (Replaced an earlier droplet-fill experiment.)
 */
const R = 24;
const CIRC = 2 * Math.PI * R; // ~150.8

export default function FitRing({ fit, size = 58 }: { fit: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(fit * 100)));
  const offset = CIRC * (1 - pct / 100);
  return (
    <div className="fitring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 56 56" style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle className="fitring-track" cx="28" cy="28" r={R} fill="none" strokeWidth="4" />
        <circle className="fitring-arc" cx="28" cy="28" r={R} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset} />
      </svg>
      <div className="fitring-label" role="img" aria-label={`${pct}% fit`}>
        <span className="fitring-num">{pct}</span>
        <span className="fitring-unit">% FIT</span>
      </div>
    </div>
  );
}
