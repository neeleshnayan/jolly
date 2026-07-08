import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";

/**
 * The front door: what drizzle IS, as minimally as it can be said.
 * One sentence of thesis, three concrete promises, the mission, one button.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // already signed in → straight to the dashboard
  if (await getSessionUserId()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <span className="brand-lockup auth-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/drizzle-lockup.svg" alt="drizzle" className="brand-light" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/drizzle-lockup-white.svg" alt="" aria-hidden className="brand-dark" />
        </span>
        <p className="brand-tag">the first rain after the drought — action over inaction</p>

        <p className="auth-thesis">
          A mentor that understands you deeply <b>once</b> — then puts that understanding to work on everything your search needs.
        </p>

        <ul className="auth-ethos">
          <li>
            <span className="auth-ethos-icon">🎙</span>
            <span><b>A mentor who remembers.</b> Voice calls that build a real read on who you&apos;re becoming — and pick up where you left off.</span>
          </li>
          <li>
            <span className="auth-ethos-icon">🎯</span>
            <span><b>Honestly matched roles.</b> Filtered by what screens actually require, ranked by what you&apos;d genuinely want — and it learns from every choice.</span>
          </li>
          <li>
            <span className="auth-ethos-icon">📄</span>
            <span><b>Apply in one motion.</b> Tailored résumé, cover letter, and every fiddly answer — staged the moment you click apply.</span>
          </li>
        </ul>

        <p className="auth-mission">
          Built after watching too many good people face a lost job alone. drizzle runs <b>at cost</b> — you pay what it costs to keep the lights on, nothing more.
        </p>

        {error && (
          <p className="status-line error">
            Sign-in didn&apos;t complete ({error}). Please try again.
          </p>
        )}
        <a className="linkedin-btn" href="/api/auth/linkedin">
          <span className="in-badge">in</span>
          Continue with LinkedIn
        </a>
        <p className="auth-fine">We only read your name, email, and photo to set up your account.</p>
      </div>
    </main>
  );
}
