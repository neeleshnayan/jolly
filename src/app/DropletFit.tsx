/**
 * The signature fit gauge — the drizzle drop, filled to the role's fit %.
 * A ring says "85%"; the drop *is* the brand (logo, loader, and now the metric).
 * Liquid rises to the score; the number reads over it. Themed off --accent.
 */
const DROP = "M28 3 C28 3 8 27 8 42 a20 20 0 0 0 40 0 C48 27 28 3 28 3 Z";

export default function DropletFit({ fit, size = 60 }: { fit: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(fit * 100)));
  // fillable band ≈ y 3 (tip) → 62 (bulb bottom); liquid top rises with the score
  const liquidTop = 62 - (pct / 100) * 59;
  return (
    <svg
      className="dropfit"
      width={size}
      height={Math.round(size * (70 / 56))}
      viewBox="0 0 56 70"
      role="img"
      aria-label={`${pct}% fit`}
    >
      <defs>
        <clipPath id="dropfit-clip">
          <path d={DROP} />
        </clipPath>
      </defs>
      <path className="dropfit-back" d={DROP} />
      <g clipPath="url(#dropfit-clip)">
        <rect className="dropfit-liquid" x="0" y={liquidTop} width="56" height="70" />
      </g>
      <path className="dropfit-outline" d={DROP} />
      <text className="dropfit-num" x="28" y="41" textAnchor="middle">{pct}</text>
      <text className="dropfit-unit" x="28" y="51" textAnchor="middle">% FIT</text>
    </svg>
  );
}
