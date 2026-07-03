import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Career Co-Pilot",
  description: "Drop your résumé. Get a clean, editable version in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
