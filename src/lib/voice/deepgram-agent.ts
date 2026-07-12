/**
 * Build the Deepgram Voice Agent's system prompt = drizzle's REAL mentor, so the
 * cloud agent knows who this user is (their map, spectrum, circle) — not a generic
 * assistant. Reuses the exact context assembly the local mentor turn uses; the
 * Voice Agent takes one prompt string, so we flatten core + delta into one.
 */
import { getMentorMap } from "@/lib/profile/map";
import { getCallSpectrum } from "@/lib/opportunities/recommend";
import { deriveSeekerEdge, matchMentorsWithBackfill, type MentorMatch } from "@/lib/mentors/match";
import { buildMentorSystemPrompt, type CircleMentor } from "@/agents/mentor/prompt";

export async function buildDeepgramAgentPrompt(userId: string): Promise<{ prompt: string; greeting: string }> {
  const [map, spectrum] = await Promise.all([
    getMentorMap(userId),
    getCallSpectrum(userId).catch(() => []),
  ]);

  // the human circle the mentor may offer as intros mid-call (same as turn.ts)
  const circle: CircleMentor[] = await deriveSeekerEdge(userId)
    .then((edge) => (edge ? matchMentorsWithBackfill(userId, edge) : []))
    .then((ms: MentorMatch[]) =>
      ms.slice(0, 3).map((m) => ({
        name: m.name ?? "a mentor",
        move: m.transitions?.[0] ? `${m.transitions[0].from} → ${m.transitions[0].to}` : (m.headline ?? ""),
        expertise: (m.expertise ?? []).slice(0, 3).join(", "),
      })),
    )
    .catch(() => []);

  // one-shot prompt (no per-turn steering — Deepgram runs its own turn loop)
  const { core, delta } = buildMentorSystemPrompt(map, spectrum, undefined, { index: 0, asked: [] }, circle);
  const first = map.profile?.fullName?.split(" ")[0] ?? "there";
  const greeting = `Hey ${first} — good to see you. What's on your mind about where your career's headed right now?`;

  // Tools are a FALLBACK, not a reflex. You already have their spectrum of roles
  // loaded above — speak from those. Over-calling makes role cards pop up at random
  // and clutters the call; call a tool only when it genuinely adds something.
  const tools = `\n\nYOU HAVE LIVE TOOLS:
- You hold a spectrum of real roles for them (above) — speak from THOSE. The moment they lean into a direction, or you name a concrete role worth exploring, CALL fetch_recommendations so real roles surface as CARDS they can see — those visible cards are a core part of this experience, so don't be shy. (Not on a single stray word, but any genuine interest in a direction should surface cards.)
- When they settle on ONE role to go deep on, CALL open_path for it.
- The INSTANT you name someone from their circle (e.g. "I've got Arjun Mehta — he went from Analyst at Goldman Sachs to VP Product at Razorpay…"), CALL introduce_mentor with that person's name and move. The card on screen is what makes the introduction real — never name a circle person without calling it.
Never announce a tool call. NEVER write or speak stage directions, tone labels, or anything in [square brackets] — say only your actual words to the person.`;

  return { prompt: `${core}\n${delta}${tools}`.trim(), greeting };
}
