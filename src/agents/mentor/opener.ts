/**
 * The mentor's first line. Instead of a canned "hi", we generate a greeting from
 * the user's map so the call opens warm and specific — it names them and points
 * at something real from their résumé, so it never feels like a cold start.
 */
import { getProvider, type ChatMessage } from "@/llm";
import { getMentorMap } from "@/lib/profile/map";
import { getCallSpectrum } from "@/lib/opportunities/recommend";
import { buildMentorSystemPrompt } from "./prompt";

export async function mentorOpener(userId: string): Promise<string> {
  const map = await getMentorMap(userId);
  const first = map.profile?.fullName?.split(" ")[0];
  const spectrum = await getCallSpectrum(userId).catch(() => []);
  const system = buildMentorSystemPrompt(map, spectrum);

  // A stage direction, not a real user turn — tells the mentor how to open.
  const direction: ChatMessage = {
    role: "user",
    content:
      "[The voice call just connected — this is your very first line. HARD RULE: do not invent or imagine anything — no texts, emails, calls, meetings, news, or events. You have ONLY their résumé. Greet them warmly" +
      (first ? ` by first name (${first})` : "") +
      ", reference ONE concrete detail that literally appears in their résumé (a company, role, or project by name), and open with either a genuine question or a light observation they can react to (don't default to 'where are you in your search'). Two spoken sentences, warm and unhurried, no lists.]",
  };

  const provider = getProvider("mentor");
  let text = "";
  try {
    for await (const d of provider.streamChat({ system, messages: [direction], maxTokens: 120 })) {
      text += d;
    }
  } catch {
    /* fall through to template */
  }
  text = text.trim();
  if (text) return text;

  // fallback if the model hiccups
  const recent = map.experiences[0];
  const role = recent?.title ? `${recent.title}${recent.org ? ` at ${recent.org}` : ""}` : null;
  if (first && role) {
    return `Hey ${first} — I was just looking over your background, ${role}. Before we get into it, where are you in your search right now, and how's it feeling?`;
  }
  return first
    ? `Hey ${first} — good to meet you. Where are you in your search right now, and how's it feeling?`
    : "Hey — I'm your career mentor. Where are you in your search right now, and how's it feeling?";
}
