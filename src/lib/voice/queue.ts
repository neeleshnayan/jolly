/**
 * The call queue — ONE live mentor call at a time. The whole voice stack
 * (whisper STT + gemma4 turns + kokoro TTS) shares a single GPU; two
 * concurrent calls means stuttering audio mid-heart-to-heart, which is
 * mission failure. A queue with an honest "your mentor is with someone —
 * you're next" beats degraded magic every time.
 *
 * In-memory (single-instance server, same pattern as the inference mutex).
 * Liveness is heartbeat-based: the client beats every ~10s during a call and
 * every poll while waiting; 30s of silence = evicted (closed tab, crashed
 * browser), so a ghost can never wedge the lane.
 */

const STALE_MS = 30_000;

type Beat = { userId: string; since: number; lastBeat: number };

let holder: Beat | null = null;
let waiting: Beat[] = [];

function prune() {
  const now = Date.now();
  if (holder && now - holder.lastBeat > STALE_MS) holder = null;
  waiting = waiting.filter((w) => now - w.lastBeat < STALE_MS);
  if (!holder && waiting.length) {
    const next = waiting.shift()!;
    holder = { ...next, since: now, lastBeat: now };
  }
}

export type QueueState = { state: "live" | "waiting"; position: number; waitingCount: number };

/** Join the queue (idempotent) or refresh your heartbeat. `priority` (a
 *  booked slot happening NOW) goes to the FRONT of the line — a reservation
 *  is a promise; it still never interrupts a live call. */
export function joinOrBeat(userId: string, priority = false): QueueState {
  prune();
  const now = Date.now();
  if (holder?.userId === userId) {
    holder.lastBeat = now;
    return { state: "live", position: 0, waitingCount: waiting.length };
  }
  const mine = waiting.find((w) => w.userId === userId);
  if (mine) {
    mine.lastBeat = now;
    if (priority && waiting[0]?.userId !== userId) {
      waiting = [mine, ...waiting.filter((w) => w.userId !== userId)];
    }
  } else if (!holder) {
    holder = { userId, since: now, lastBeat: now };
    return { state: "live", position: 0, waitingCount: 0 };
  } else if (priority) {
    waiting.unshift({ userId, since: now, lastBeat: now });
  } else {
    waiting.push({ userId, since: now, lastBeat: now });
  }
  prune(); // the lane may have just freed — promote immediately
  if (holder?.userId === userId) return { state: "live", position: 0, waitingCount: waiting.length };
  return { state: "waiting", position: waiting.findIndex((w) => w.userId === userId) + 1, waitingCount: waiting.length };
}

/** Release the lane (call ended) or leave the waiting line. */
export function leave(userId: string): void {
  if (holder?.userId === userId) holder = null;
  waiting = waiting.filter((w) => w.userId !== userId);
  prune();
}

/** For the admin panel: who holds the lane, how long, how many wait. */
export function queueStatus(): { holder: { userId: string; forSec: number } | null; waitingCount: number } {
  prune();
  return {
    holder: holder ? { userId: holder.userId, forSec: Math.round((Date.now() - holder.since) / 1000) } : null,
    waitingCount: waiting.length,
  };
}
