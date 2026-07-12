"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Floating dark/light switch. The pre-paint script in layout.tsx sets the
 *  initial theme; this just flips it and persists the choice. Hidden on the
 *  landing page, which commits to the brand's warm-dark look. */
export default function ThemeToggle() {
  const pathname = usePathname();
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

  if (pathname === "/") return null; // landing commits to the warm-dark brand look
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
