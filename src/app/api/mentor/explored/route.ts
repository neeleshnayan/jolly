/**
 * GET  /api/mentor/explored — the user's explored-path branches (comparison view).
 * POST /api/mentor/explored — record/bump a sampled path (fired on a card dive).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveUserId } from "@/lib/auth/user";
import { listExploredPaths, recordExploredPath, markCommitted } from "@/lib/explored/persist";
import { fillTargetTheme } from "@/lib/track/persist";

export const runtime = "nodejs";

export async function GET() {
  const userId = await resolveUserId(null);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const paths = await listExploredPaths(userId);
  return NextResponse.json({ ok: true, paths });
}

const bodySchema = z.object({
  userId: z.string().optional(),
  label: z.string().min(1),
  company: z.string().nullish(),
  kind: z.string().nullish(),
  source: z.string().optional(),
  summary: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.parse(await req.json());
    const userId = await resolveUserId(parsed.userId);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const id = await recordExploredPath(userId, {
      label: parsed.label,
      company: parsed.company ?? null,
      kind: parsed.kind ?? null,
      source: parsed.source,
      summary: parsed.summary,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }
}

// PATCH — commit to a path (the paid step-up). Marks committed_at.
export async function PATCH(req: Request) {
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const userId = await resolveUserId(null);
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const committed = await markCommitted(userId, id);
    // Commit = "this is my direction now" → make it the target role so the
    // recommendations re-rank toward it (trajectory + the "you set this" reason).
    // Best-effort: the commit itself already succeeded.
    if (committed?.label) {
      try {
        await fillTargetTheme(userId, committed.label, "You committed to this path from your dashboard.");
      } catch { /* retune is best-effort — commit still stands */ }
    }
    return NextResponse.json({ ok: true, retuned: !!committed?.label });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }
}
