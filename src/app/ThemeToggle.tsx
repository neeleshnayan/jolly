"use client";

import { useEffect, useState } from "react";

/** Floating dark/light switch. The pre-paint script in layout.tsx sets the
 *  initial theme; this just flips it and persists the choice. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? "light");
  }, []);

  function flip() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("drizzle-theme", next);
    } catch {}
    setTheme(next);
  }

  if (!theme) return null; // avoid a hydration-mismatch icon flash
  return (
    <button
      className="theme-toggle no-print"
      onClick={flip}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
