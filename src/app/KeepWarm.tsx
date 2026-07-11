"use client";
import { useEffect } from "react";

/**
 * Heartbeat that keeps the free-tier Cloudflare Worker isolate WARM while the app
 * is open. A cold isolate's first hit hangs (cold-start blows the 10ms CPU limit),
 * so we ping a trivial route every 20s — and again the moment a backgrounded tab
 * refocuses (isolates cool while you're away). ~50 bytes each, fire-and-forget.
 *
 * Mounted once in the root layout. No-op-safe: failures are swallowed. On Node
 * dev it's harmless (the pool's always warm).
 */
const WARM_MS = 20_000;

export default function KeepWarm() {
  useEffect(() => {
    const ping = () => {
      void fetch("/api/ping", { cache: "no-store", keepalive: true }).catch(() => {});
    };
    ping(); // warm immediately on mount
    const id = setInterval(ping, WARM_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return null;
}
