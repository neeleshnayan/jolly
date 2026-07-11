import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import MentorCall from "./MentorCall";
import DeepgramMentorCall from "./DeepgramMentorCall";

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; dg?: string }>;
}) {
  const { u, dg } = await searchParams;
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) redirect("/login");

  // Deepgram Voice Agent = the prod voice path; local dev stays on the Kokoro
  // pipeline (MentorCall). Force Deepgram with ?dg=1 for testing.
  const useDeepgram = dg === "1" || (process.env.VOICE_PROVIDER ?? "").toLowerCase() === "deepgram";

  return (
    <main className="upload-wrap">
      {useDeepgram ? <DeepgramMentorCall userId={userId} /> : <MentorCall userId={userId} />}
    </main>
  );
}
