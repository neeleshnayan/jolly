/**
 * The mentor's live turn — the FAST PATH. Loads the map, builds the steering
 * prompt, and streams the next spoken reply. Deliberately NOT the discrete
 * Agent<I,O> shape (that's for one-shot units); a voice turn is a stream.
 * Insight extraction (the SLOW PATH) is a separate agent that runs post-call.
 */
import type { ChatMessage } from "@/llm";
import { getProvider, getProviderByName } from "@/llm";
import { getMentorMap } from "@/lib/profile/map";
import { getCallSpectrum } from "@/lib/opportunities/recommend";
import { buildMentorSystemPrompt } from "./prompt";

// Per-call context cache: the map + spectrum barely change between turns, but
// rebuilding them cost ~8-10 DB round trips PER SPOKEN TURN — pure latency on
// a flaky pooler, and pure waste at scale. 3-min TTL ≈ one conversation's
// stretch; a mid-call résumé edit shows up next call, which is fine.
const CTX_TTL_MS = 3 * 60 * 1000;
const ctxCache = new Map<string, { at: number; map: Awaited<ReturnType<typeof getMentorMap>>; spectrum: Awaited<ReturnType<typeof getCallSpectrum>> }>();

async function callContext(userId: string) {
  const hit = ctxCache.get(userId);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return hit;
  const map = await getMentorMap(userId);
  const spectrum = await getCallSpectrum(userId).catch(() => []);
  const entry = { at: Date.now(), map, spectrum };
  ctxCache.set(userId, entry);
  if (ctxCache.size > 200) ctxCache.delete(ctxCache.keys().next().value!); // bound memory
  return entry;
}

/** Pull the question sentences out of the mentor's past turns — fed back into
 *  the prompt as a hard no-repeat list (small models won't track this alone). */
function askedQuestions(messages: ChatMessage[]): string[] {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.content.split(/(?<=[.?!])\s+/).filter((s) => s.trim().endsWith("?")))
    .map((q) => q.trim())
    .slice(-8); // recent ones matter most; keep the prompt lean
}

export async function* mentorTurn(input: {
  userId: string;
  messages: ChatMessage[];
  secondsLeft?: number;
  // A/B override from the in-call debug toggle ("ollama" | "anthropic").
  // Callers are responsible for gating WHO may set this (see /api/voice/turn).
  brain?: string;
}): AsyncIterable<string> {
  const { map, spectrum } = await callContext(input.userId);
  const turnIndex = input.messages.filter((m) => m.role === "assistant").length;
  const system = buildMentorSystemPrompt(map, spectrum, input.secondsLeft, {
    index: turnIndex,
    asked: askedQuestions(input.messages),
  });
  const provider = getProviderByName(input.brain) ?? getProvider("mentor");
  yield* provider.streamChat({
    system,
    messages: input.messages,
    maxTokens: 400, // spoken turns should be short
  });
}
