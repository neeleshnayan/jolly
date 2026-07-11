/**
 * Sentence segmentation for the STREAMING mentor turn. The LLM streams deltas;
 * we flush a sentence the moment it's complete so TTS can start speaking it
 * while the model is still writing the next one — the single biggest latency
 * win in the pipeline (first word out after sentence 1, not the whole reply).
 *
 * Two small state machines:
 *  - makeSegmenter(): buffers deltas, emits clean speakable sentences.
 *  - makeMarkerFilter(): strips a control marker (e.g. [[END_CALL]]) even when
 *    it's split across deltas, holding back only a tiny suffix.
 */

// Stage directions sneak past the prompt on small models — "(pauses, letting the
// silence hang)" would be SPOKEN by TTS and shown in the caption. Strip
// parentheticals that OPEN with an acting verb; ones carrying real content
// ("(TxB's first marketplace)") are untouched. Mirrors the client's playText
// strip so audio and caption agree. Keep the two in sync if either changes.
const STAGE =
  /\s*[(*[]\s*(?:pauses?|pausing|beat\b|silence|laughs?|laughing|chuckles?|chuckling|sighs?|sighing|smiles?|smiling|nods?|nodding|leans?|leaning|softly|gently|warmly|quietly|thoughtfully|clears throat|takes a (?:deep )?breath|lets? the silence)[^)*\]]*[)*\]]\s*/gi;

export function cleanForSpeech(s: string): string {
  return s.replace(STAGE, " ").replace(/\s{2,}/g, " ").trim();
}

// Tokens that end in a period but aren't sentence ends. Matched against the tail
// of the text before the terminator, so a "." after any of these won't flush.
const ABBR =
  /(?:^|[\s("'])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no|inc|ltd|co|fig|approx|dept|gen|rep|sen|gov|ave|u\.s|u\.k|a\.m|p\.m|ph\.d)$/i;

/** Index just past a real sentence terminator, or -1. Only accepts a terminator
 *  already followed by whitespace, so a "." sitting at the very end of the
 *  current buffer waits for the next delta (it may be a decimal, an
 *  abbreviation, or a sentence that keeps going). Any complete sentence flushes
 *  immediately — short ones too ("Yes.") — so the first audio starts fast. */
function findCut(buf: string): number {
  const re = /[.!?…]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    const end = m.index + m[0].length;
    const next = buf[end] ?? "";
    if (next === "" || !/\s/.test(next)) continue; // need a following space to be sure
    if (m[0] === ".") {
      // decimal like "3.5"
      if (/\d/.test(buf[m.index - 1] ?? "") && /\d/.test(buf[end] ?? "")) continue;
      // single-letter initial like "J." in "J. R. R." — the token is one capital
      const before = buf.slice(0, m.index);
      if (/(?:^|\s)[A-Z]$/.test(before)) continue;
    }
    if (ABBR.test(buf.slice(0, m.index))) continue; // Mr. / e.g. / U.S.
    return end;
  }
  return -1;
}

export type Segmenter = { push(delta: string): string[]; flush(): string[] };

/** A speakable piece must contain at least one letter/number — never emit a lone
 *  "." or "…" as its own TTS clip. */
const HAS_WORD = /[A-Za-z0-9]/;

/** max: force a clause break if a sentence runs on with no terminator, so we
 *  don't sit silent on a rambling reply. */
export function makeSegmenter(opts?: { max?: number }): Segmenter {
  const max = opts?.max ?? 240;
  let buf = "";

  function emit(piece: string, out: string[]) {
    const clean = cleanForSpeech(piece);
    if (clean && HAS_WORD.test(clean)) out.push(clean);
  }

  function extract(force: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const cut = findCut(buf);
      if (cut === -1) break;
      emit(buf.slice(0, cut), out);
      buf = buf.slice(cut).replace(/^\s+/, "");
    }
    if (force) {
      emit(buf, out);
      buf = "";
    } else if (buf.length > max) {
      // no terminator but the buffer is long — break at the last space
      const sp = buf.lastIndexOf(" ", max);
      const at = sp > 40 ? sp : max;
      emit(buf.slice(0, at), out);
      buf = buf.slice(at).replace(/^\s+/, "");
    }
    return out;
  }

  return {
    push: (delta) => {
      buf += delta;
      return extract(false);
    },
    flush: () => extract(true),
  };
}

/** Strip a control marker from a delta stream, robust to the marker being split
 *  across chunk boundaries. Calls onSeen() once when a full marker passes. */
export function makeMarkerFilter(marker: string, onSeen: () => void) {
  let carry = "";
  return {
    push(delta: string): string {
      let s = carry + delta;
      if (s.includes(marker)) {
        onSeen();
        s = s.split(marker).join("");
      }
      // hold back a suffix that could be the start of the marker
      let hold = 0;
      for (let k = Math.min(marker.length - 1, s.length); k > 0; k--) {
        if (s.endsWith(marker.slice(0, k))) {
          hold = k;
          break;
        }
      }
      carry = hold ? s.slice(s.length - hold) : "";
      return hold ? s.slice(0, s.length - hold) : s;
    },
    flush(): string {
      const r = carry;
      carry = "";
      return r;
    },
  };
}
