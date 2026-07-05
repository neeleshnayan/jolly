import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";

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
        <h1>Career Co-Pilot</h1>
        <p className="sub">
          Sign in to pick up your résumé, your mentor&apos;s understanding of you, and your job matches.
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
