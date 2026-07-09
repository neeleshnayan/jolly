/**
 * The drizzle "thinking" indicator — the brand drop, alive while we work.
 * A gentle squash-bob, ripple rings at its base, a breathing halo, and a
 * shimmering label. Implemented from the "Drizzle Thinking" design; pure SVG +
 * CSS (keyframes in globals.css), themed off --accent so it glows in warm-dark.
 *
 *   <DrizzleLoader label="Finding roles that fit…" />   // centered, default
 *   <DrizzleLoader size={22} row label="Checking…" />   // inline beside text
 */
const DROP = "M20 2C20 2 5 19.5 5 31a15 15 0 0 0 30 0C35 19.5 20 2 20 2Z";
const HIGHLIGHT = "M13 30a7 7 0 0 0 3.2 5.9";

export default function DrizzleLoader({
  size = 38,
  label,
  row = false,
  className,
}: {
  size?: number;
  label?: string;
  row?: boolean;
  className?: string;
}) {
  const h = Math.round(size * 1.2);
  return (
    <div
      className={`drizzle-loader${row ? " row" : ""}${className ? " " + className : ""}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
    >
      <span className="dz-mark" style={{ width: size, height: h }} aria-hidden="true">
        <span className="dz-halo" />
        <span className="dz-ripple" />
        <span className="dz-ripple dz-ripple2" />
        <span className="dz-drop">
          <svg width={size} height={h} viewBox="0 0 40 48" fill="none">
            <path d={DROP} fill="currentColor" />
            <path d={HIGHLIGHT} stroke="rgba(255,255,255,0.6)" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
      </span>
      {label && <span className="drizzle-loader-label dz-shimmer">{label}</span>}
    </div>
  );
}
