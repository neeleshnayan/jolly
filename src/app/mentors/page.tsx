/**
 * /mentors — Mentor Connect: people who've already made the move you're
 * attempting. AI does discovery, humans provide experience.
 */
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import MentorsClient from "./MentorsClient";

export default async function MentorsPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const userId = (await getSessionUserId()) ?? (process.env.NODE_ENV !== "production" ? u : undefined);
  if (!userId) redirect("/login");
  return <MentorsClient userId={userId} />;
}
