/**
 * The timing channel — HOW a turn was spoken, summarized for the mentor brain.
 * The transcript loses half the message: an 8-second silence before "I
 * guess..." IS the answer. No ML — three numbers the client already has
 * (answer delay, speech duration, barge-in), turned into a short bracketed
 * note ONLY when the signal is strong. Quiet turns get no note at all, so the
 * model isn't tempted to narrate normality.
 */

export type TurnTiming = {
  answerDelaySec: number | null;
  speechSec: number | null;
  barged: boolean;
};

export function parseTiming(raw: unknown): TurnTiming | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TurnTiming>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 600 ? x : null);
    return { answerDelaySec: num(v.answerDelaySec), speechSec: num(v.speechSec), barged: v.barged === true };
  } catch {
    return null;
  }
}

/** Empty string when nothing noteworthy happened — most turns. */
export function timingNote(t: TurnTiming | null, userText: string): string {
  if (!t) return "";
  const notes: string[] = [];
  if (t.barged) notes.push("they jumped in before you finished speaking");
  else if (t.answerDelaySec !== null && t.answerDelaySec >= 4) {
    notes.push(`they sat in silence for about ${Math.round(t.answerDelaySec)} seconds before starting to answer`);
  }
  const words = userText.split(/\s+/).filter(Boolean).length;
  if (t.speechSec !== null && t.speechSec >= 3 && words >= 6) {
    const wps = words / t.speechSec;
    if (wps < 1.6) notes.push("they spoke noticeably slowly, with hesitation");
    else if (wps > 3.6) notes.push("they answered fast, with real energy");
  }
  return notes.length ? `[how they said it: ${notes.join("; ")}]\n` : "";
}
