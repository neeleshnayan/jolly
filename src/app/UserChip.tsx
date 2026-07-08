"use client";

import { useEffect, useRef, useState } from "react";

type Me = { userId: string | null; name?: string | null; email?: string | null; avatarUrl?: string | null };

/**
 * The signed-in identity, for any topbar: name + clickable avatar that opens
 * a small profile menu (sign-out lives here now — this menu is where account
 * features accumulate over time). Self-fetches identity from the session so it
 * works in both server- and client-rendered pages. Renders nothing when
 * there's no session (e.g. dev ?u= mode).
 */
export default function UserChip() {
  const [me, setMe] = useState<Me>({ userId: null });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, []);

  // click-outside + Esc close
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!me.userId) return null;
  const initial = (me.name ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <span className="user-chip" ref={ref}>
      <span className="chip-name">{me.name ?? "You"}</span>
      <button className="chip-avatar-btn" onClick={() => setOpen((v) => !v)} title="Account" aria-haspopup="menu" aria-expanded={open}>
        {me.avatarUrl ? <img className="chip-avatar" src={me.avatarUrl} alt="" /> : <span className="chip-avatar chip-avatar-fallback">{initial}</span>}
      </button>
      {open && (
        <div className="chip-menu" role="menu">
          <div className="chip-menu-id">
            <div className="chip-menu-name">{me.name ?? "You"}</div>
            {me.email && <div className="chip-menu-email">{me.email}</div>}
          </div>
          <a className="chip-menu-item" href="/insights" role="menuitem">About you</a>
          <a className="chip-menu-item chip-menu-danger" href="/api/auth/logout" role="menuitem">Sign out</a>
        </div>
      )}
    </span>
  );
}
