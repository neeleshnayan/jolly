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
  const tools = `\n\nYOU HAVE LIVE TOOLS — use them SPARINGLY:
- You already hold a spectrum of real roles for them (above). Talk from THOSE. Only call fetch_recommendations if they steer toward a genuinely NEW direction those don't cover, AND they've clearly leaned into exploring it — never on a passing mention or a single word. When in doubt, keep talking, don't call.
- Only when they truly settle on ONE role to go deep on, CALL open_path for it.
Never announce a tool call.`;

  return { prompt: `${core}\n${delta}${tools}`.trim(), greeting };
}
