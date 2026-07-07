/**
 * /admin — the operator's control room. Gated by ADMIN_EMAILS; everyone else
 * is bounced to the dashboard without learning the page exists.
 */
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import AdminPanel from "./AdminPanel";

export default async function AdminPage() {
  const adminId = await requireAdmin();
  if (!adminId) redirect("/dashboard");
  return <AdminPanel />;
}
