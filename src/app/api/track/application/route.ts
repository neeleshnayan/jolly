import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { createApplication, setApplicationStatus } from "@/lib/track/persist";

export const runtime = "nodejs";

// POST — create an application
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = (await getSessionUserId()) ?? body.userId;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const app = await createApplication(userId, {
      company: typeof body.company === "string" ? body.company : undefined,
      role: typeof body.role === "string" ? body.role : undefined,
      resumeVersionId: typeof body.resumeVersionId === "string" ? body.resumeVersionId : undefined,
    });
    return NextResponse.json({ ok: true, application: app });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// PATCH — advance an application's stage
export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = (await getSessionUserId()) ?? body.userId;
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (typeof body.applicationId !== "string" || typeof body.stage !== "string") {
      return NextResponse.json({ error: "applicationId and stage required" }, { status: 400 });
    }
    await setApplicationStatus(userId, body.applicationId, body.stage, body.result);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
