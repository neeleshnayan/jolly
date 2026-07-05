import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth/session";

// The root just routes: signed in → your dashboard, otherwise → sign in.
export default async function Home() {
  if (await getSessionUserId()) redirect("/dashboard");
  redirect("/login");
}
