/**
 * The drizzle lockup, theme-aware: the navy lockup in light mode, the white one
 * in dark. Both render and CSS shows exactly one — no JS, no flash on toggle.
 */
export default function Brand({ size = 24 }: { size?: number }) {
  return (
    <a href="/dashboard" className="brand-lockup" style={{ height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/drizzle-lockup.svg" alt="drizzle" className="brand-light" height={size} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/drizzle-lockup-white.svg" alt="" aria-hidden className="brand-dark" height={size} />
    </a>
  );
}
