import { NextResponse } from "next/server";
import { resolveUserId } from "@/lib/auth/user";
import { createApplication, setApplicationStatus, updateApplication } from "@/lib/track/persist";

export const runtime = "nodejs";

// POST — create an application
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const app = await createApplication(userId, {
      company: typeof body.company === "string" ? body.company : undefined,
      role: typeof body.role === "string" ? body.role : undefined,
      resumeVersionId: typeof body.resumeVersionId === "string" ? body.resumeVersionId : undefined,
      // links the application to the recommended role — this is the seam the
      // outcome funnel (and later, the "who else interviewed here" graph) hangs off
      opportunityId: typeof body.opportunityId === "string" ? body.opportunityId : undefined,
    });
    return NextResponse.json({ ok: true, application: app });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// PATCH — advance an application's stage, and/or edit its kanban card
// (notes / follow-up date). Stage changes append to the funnel timeline;
// card edits are plain updates.
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = await resolveUserId(body.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof body.applicationId !== "string") {
      return NextResponse.json({ error: "applicationId required" }, { status: 400 });
    }
    if (typeof body.stage === "string") {
      await setApplicationStatus(userId, body.applicationId, body.stage, body.result);
    }
    if ("notes" in body || "followUpAt" in body) {
      await updateApplication(userId, body.applicationId, {
        ...("notes" in body ? { notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.slice(0, 2000) : null } : {}),
        ...("followUpAt" in body ? { followUpAt: body.followUpAt ? new Date(body.followUpAt) : null } : {}),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
