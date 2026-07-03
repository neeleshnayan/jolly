/**
 * The mentor's live turn — the FAST PATH. Loads the map, builds the steering
 * prompt, and streams the next spoken reply. Deliberately NOT the discrete
 * Agent<I,O> shape (that's for one-shot units); a voice turn is a stream.
 * Insight extraction (the SLOW PATH) is a separate agent that runs post-call.
 */
import type { ChatMessage } from "@/llm";
import { getProvider } from "@/llm";
import { getMentorMap } from "@/lib/profile/map";
import { buildMentorSystemPrompt } from "./prompt";

export async function* mentorTurn(input: {
  userId: string;
  messages: ChatMessage[];
}): AsyncIterable<string> {
  const map = await getMentorMap(input.userId);
  const system = buildMentorSystemPrompt(map);
  const provider = getProvider();
  yield* provider.streamChat({
    system,
    messages: input.messages,
    maxTokens: 400, // spoken turns should be short
  });
}
