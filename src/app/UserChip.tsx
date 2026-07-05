"use client";

import { useEffect, useState } from "react";

type Me = { userId: string | null; name?: string | null; avatarUrl?: string | null };

/**
 * Signed-in avatar + name + sign-out, for any topbar. Self-fetches identity from
 * the session so it works in both server- and client-rendered pages. Renders
 * nothing when there's no session (e.g. dev ?u= mode).
 */
export default function UserChip() {
  const [me, setMe] = useState<Me>({ userId: null });
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, []);
  if (!me.userId) return null;
  return (
    <span className="user-chip">
      {me.avatarUrl && <img className="chip-avatar" src={me.avatarUrl} alt="" />}
      <span className="chip-name">{me.name ?? "You"}</span>
      <a className="chip-signout" href="/api/auth/logout" title="Sign out">Sign out</a>
    </span>
  );
}
