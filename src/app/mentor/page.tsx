import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import MentorCall from "./MentorCall";

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) redirect("/login");

  return (
    <main className="upload-wrap">
      <MentorCall userId={userId} />
    </main>
  );
}
