/**
 * POST /api/mentor/review — commit the user-approved insights to the map.
 * This is the ONLY path that writes mentor-call insights: the user has seen the
 * recap, corrected what was wrong, and tapped save. Insights are validated
 * (dimension enum, confidence range) before they touch Layer 3.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { persistInsights } from "@/lib/insights/persist";
import { extractedInsight } from "@/lib/insights/schema";

export const runtime = "nodejs";

const bodySchema = z.object({
  userId: z.string().min(1),
  transcript: z.string().default(""),
  insights: z.array(extractedInsight).default([]),
});

export async function POST(req: Request) {
  try {
    const { userId, transcript, insights } = bodySchema.parse(await req.json());
    const result = await persistInsights({
      userId,
      extraction: { insights },
      transcript,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[/api/mentor/review]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 },
    );
  }
}
