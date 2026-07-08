"use client";

/**
 * The mentor's diary — book a 30-minute slot instead of calling now. A booking
 * is a commitment device ("my mentor expects me at 7:30") AND front-of-line
 * priority in the call lane at slot time.
 */
import { useCallback, useEffect, useState } from "react";

type Slot = { at: string; state: "free" | "taken" | "yours" };
type Day = { date: string; slots: Slot[] };

const fmtSlot = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtDay = (d: string) => {
  const date = new Date(d);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export default function SlotPicker({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<Day[]>([]);
  const [dayIdx, setDayIdx] = useState(0);
  const [mine, setMine] = useState<{ id: string; slotAt: string } | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const j = await fetch(`/api/voice/bookings?u=${userId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (j?.ok) {
      setDays(j.days ?? []);
      setMine(j.mine ?? null);
    }
  }, [userId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function book(at: string) {
    setMsg("");
    const r = await fetch("/api/voice/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ u: userId, slotAt: at }),
    });
    const j = await r.json();
    if (!r.ok) setMsg(j.error ?? "Couldn't book");
    await load();
  }
  async function cancel(id: string) {
    await fetch("/api/voice/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ u: userId, cancel: id }),
    });
    await load();
  }

  if (mine && !open) {
    return (
      <div className="slot-mine">
        📅 Your mentor expects you <b>{fmtDay(mine.slotAt)} at {fmtSlot(mine.slotAt)}</b>
        <button className="ai-cancel" onClick={() => cancel(mine.id)} title="Free the slot">cancel</button>
      </div>
    );
  }

  return (
    <div className="slot-picker">
      <button className="ghost-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "close" : "📅 or book a slot"}
      </button>
      {open && (
        <div className="slot-panel">
          {mine ? (
            <div className="slot-mine">
              📅 Booked: <b>{fmtDay(mine.slotAt)} at {fmtSlot(mine.slotAt)}</b>
              <button className="ai-cancel" onClick={() => cancel(mine.id)}>cancel</button>
            </div>
          ) : (
            <>
              <div className="slot-days">
                {days.map((d, i) => (
                  <button key={d.date} className={`slot-day${i === dayIdx ? " on" : ""}`} onClick={() => setDayIdx(i)}>
                    {fmtDay(d.date)}
                  </button>
                ))}
              </div>
              <div className="slot-grid">
                {(days[dayIdx]?.slots ?? []).map((s) => (
                  <button key={s.at} className={`slot-chip ${s.state}`} disabled={s.state === "taken"} onClick={() => s.state === "free" && void book(s.at)}>
                    {fmtSlot(s.at)}
                  </button>
                ))}
              </div>
              <div className="slot-hint">30 minutes with your mentor, reserved — you get the front of the line at slot time.</div>
            </>
          )}
          {msg && <div className="ai-err">{msg}</div>}
        </div>
      )}
    </div>
  );
}
