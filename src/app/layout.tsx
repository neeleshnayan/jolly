import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "./ThemeToggle";

export const metadata: Metadata = {
  title: "drizzle — your career co-pilot",
  description: "Understood once, working for you everywhere: résumé, mentor, opportunities.",
  openGraph: {
    title: "drizzle — your career co-pilot",
    description: "The first rain after the drought — action over inaction.",
    images: ["/brand/drizzle-og.png"],
  },
};

// Runs before paint: applies the saved (or OS-preferred) theme so there's no
// light-flash on load. Kept tiny and inline for that reason.
const themeInit = `(function(){try{var t=localStorage.getItem("drizzle-theme");if(!t){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
