/**
 * The drizzle loader — the brand droplet filling with liquid, for any "we're
 * working on it" moment. Pure SVG + CSS (keyframes live in globals.css), so it
 * drops into server or client components with no JS. Brand orange on any bg,
 * theme-agnostic; respects prefers-reduced-motion.
 *
 *   <DrizzleLoader label="Finding roles that fit…" />        // centered, default
 *   <DrizzleLoader size={28} row label="Checking…" />        // inline beside text
 *
 * The clip-path id is shared on purpose: every instance clips to the SAME
 * droplet shape, so an id collision across multiple loaders is harmless.
 */
const DROP = "M60 24 C60 24 26 76 26 110 a34 34 0 0 0 68 0 C94 76 60 24 60 24 Z";

export default function DrizzleLoader({
  size = 72,
  label,
  row = false,
  className,
}: {
  size?: number;
  label?: string;
  row?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`drizzle-loader${row ? " row" : ""}${className ? " " + className : ""}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
    >
      <svg
        className="drizzle-loader-mark"
        width={size}
        height={Math.round(size * 1.3)}
        viewBox="0 0 120 156"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="drizzle-loader-clip">
            <path d={DROP} />
          </clipPath>
        </defs>
        <g className="dl-group">
          <path className="dl-back" d={DROP} />
          <g clipPath="url(#drizzle-loader-clip)">
            <rect className="dl-liquid" x="24" y="28" width="72" height="132" />
          </g>
          <path className="dl-outline" d={DROP} />
        </g>
        <circle className="dl-drip" cx="60" cy="150" r="5" />
      </svg>
      {label && <span className="drizzle-loader-label">{label}</span>}
    </div>
  );
}
