/**
 * Post-call recap. Turns a raw mentor-call transcript into a short, warm
 * second-person summary the user can read back and correct. Runs on the fast
 * live model (streamChat) since it's a light generation, not structured output.
 */
import { getProvider } from "@/llm";

const SYSTEM = `You summarize a career mentoring call for the person who was on it.
Write a short second-person recap (3–5 sentences) of what you talked about and what
the mentor came to understand about them. Be warm and concrete. No preamble, no
bullet points, no headings — just the recap paragraph.`;

export async function summarizeCall(transcript: string): Promise<string> {
  const provider = getProvider("mentor");
  let out = "";
  for await (const delta of provider.streamChat({
    system: SYSTEM,
    messages: [{ role: "user", content: `Transcript:\n${transcript}` }],
    maxTokens: 320,
  })) {
    out += delta;
  }
  return out.trim();
}
