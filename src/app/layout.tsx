import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "./ThemeToggle";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "drizzle — your career co-pilot",
  description: "Understood once, working for you everywhere: résumé, mentor, opportunities.",
  openGraph: {
    title: "drizzle — your career co-pilot",
    description: "The first rain after the drought — action over inaction.",
    images: ["/brand/drizzle-og.png"],
  },
};

// Runs before paint: applies the saved theme so there's no flash on load. Dark
// is the default — the warm-dark look is drizzle's premium face; light is opt-in.
const themeInit = `(function(){try{var t=localStorage.getItem("drizzle-theme")||"dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})()`;

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
