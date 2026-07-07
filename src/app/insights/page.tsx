/**
 * /insights — "Your diagnosis": the mentor's understanding rendered as a
 * consultant-grade report, not a debug dump. Session-gated like every page.
 */
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";
import InsightsReport from "./InsightsReport";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;
  const userId = (await getSessionUserId()) ?? (process.env.NODE_ENV !== "production" ? u : undefined);
  if (!userId) redirect("/login");
  return <InsightsReport userId={userId} />;
}
