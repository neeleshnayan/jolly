/**
 * Flatten a profile (résumé facts + mentor-call insights) into the text the
 * scorer reads. Shared by the debug profile view and the matcher.
 */
import type { getFullProfile } from "@/lib/profile/read";

type FullProfile = NonNullable<Awaited<ReturnType<typeof getFullProfile>>>;

export function buildProfileText(
  full: FullProfile,
  insights: { dimension: string; content: string; confidence: number | null }[],
): string {
  const p = full.profile;
  const exp = full.experiences
    .map(
      (e) =>
        `- ${e.title ?? "role"}${e.org ? ` @ ${e.org}` : ""} (${e.startDate ?? "?"}–${e.endDate ?? "?"})` +
        (e.bullets?.length ? `\n  ${e.bullets.map((b) => b.text).join("\n  ")}` : ""),
    )
    .join("\n");
  const edu = full.education
    .map((e) => `- ${e.degree ?? ""} ${e.field ?? ""} @ ${e.institution ?? "?"}`.trim())
    .join("\n");
  const skills = full.skills.map((sk) => sk.name).join(", ");
  const learned = insights.length
    ? insights.map((i) => `- [${i.dimension}] ${i.content}`).join("\n")
    : "(no mentor-call insights yet)";

  return `Name: ${p.fullName ?? "?"}
Headline: ${p.headline ?? "?"}
Location: ${p.location ?? "?"}

Experience:
${exp || "(none)"}

Education:
${edu || "(none)"}

Skills: ${skills || "(none)"}

What the mentor has learned so far:
${learned}`;
}
